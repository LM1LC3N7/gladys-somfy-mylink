// -----------------------------------------------------------------------------
// The messages of the MyLink Synergy API (pure). Ported from pysomfymylink
// (MIT, Stefan Slivinski; a clean-room rewrite of somfy-mylink-synergy by Ben
// Dews, MIT): see THIRD_PARTY_NOTICES.md.
//
// A request is one JSON object written on the socket:
//   {"id": 7, "method": "mylink.move.up", "params": {"targetID": "CC0000A.1", "auth": "<System ID>"}}
// The bridge answers with one JSON object carrying the same id, `result` or
// `error` ({ code, message }; -32652 "Invalid auth" for a refused System ID),
// and sends `{"keepalive": …}` objects in between. Objects follow each other
// without a separator: they are cut here by counting braces outside strings
// (one pass, bounded), never by a regular expression over the whole stream.
//
// The System ID only ever goes into the bytes of a request: never into an
// error, a log line, a status or /data.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { LIMITS } from '../constants.js';

/**
 * The id of a shade as the bridge gives it ("CC0000A.1": the bridge, a dot,
 * the channel). Never the wildcard "*.*" (every shade) nor anything with a
 * star, a space or a control character.
 */
export const TARGET_ID = /^[A-Za-z0-9_-]{1,32}(\.[A-Za-z0-9_-]{1,8})?$/;

/** A scene id: a non-negative integer (sent as a number). */
export const SCENE_ID = /^(0|[1-9]\d{0,9})$/;

/** Errors by kind; `written` tells whether the request may have left. */
export class LinkError extends Error {
  constructor(kind, { written = false, code, cause } = {}) {
    super(kind);
    this.name = 'LinkError';
    this.kind = kind;
    this.written = written;
    if (code !== undefined) {
      this.code = code;
    }
    if (cause) {
      // Only the system code (ECONNREFUSED…): never a message that could
      // carry an address or a payload.
      this.errno = typeof cause.code === 'string' ? cause.code.slice(0, 20) : undefined;
    }
  }
}

/**
 * A System ID typed by the user: printable ASCII only (it enters every
 * request), trimmed, 1 to 64 characters. Undefined otherwise; never echoed.
 */
export function normalizeSystemId(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const text = value.trim();
  if (text.length === 0 || text.length > LIMITS.systemId) {
    return undefined;
  }
  return /^[\x21-\x7e]+$/.test(text) ? text : undefined;
}

/**
 * A marker of a System ID refused by the bridge: 8 bits of its SHA-256, so
 * that /data proves nothing about it (256 candidates for any guess), and a
 * changed System ID is tried again (a 1 in 256 chance that it shares the
 * marker: "Test the connection" then clears it).
 */
export const refusedMarker = (systemId) =>
  createHash('sha256').update(String(systemId)).digest('hex').slice(0, 2);

/** The bytes of one request. */
export function encodeRequest(id, method, params, systemId) {
  return Buffer.from(JSON.stringify({ id, method, params: { ...params, auth: systemId } }), 'utf8');
}

/**
 * Cuts the stream of the bridge into JSON objects. `push(chunk)` returns the
 * texts of the objects completed by that chunk; bytes outside an object
 * (spaces, newlines) are skipped. Throws a LinkError('tooLarge') past
 * `objectBytes` for one object or `connectionBytes` in all, and
 * LinkError('format') for anything else than an object at the top level.
 */
export class ObjectScanner {
  constructor({ objectBytes = LIMITS.objectBytes, connectionBytes = LIMITS.connectionBytes } = {}) {
    this.objectBytes = objectBytes;
    this.connectionBytes = connectionBytes;
    this.total = 0;
    this.depth = 0;
    this.inString = false;
    this.escape = false;
    /** Slices of the object being read (one per chunk: no quadratic concatenation). */
    this.parts = [];
    this.size = 0;
  }

  push(chunk) {
    this.total += chunk.length;
    if (this.total > this.connectionBytes) {
      throw new LinkError('tooLarge');
    }
    const out = [];
    let start = this.depth > 0 ? 0 : -1;
    for (let i = 0; i < chunk.length; i += 1) {
      const byte = chunk[i];
      if (this.depth === 0) {
        if (byte === 0x7b) {
          this.depth = 1;
          start = i;
          this.size = 0;
          this.parts = [];
        } else if (byte !== 0x20 && byte !== 0x0a && byte !== 0x0d && byte !== 0x09) {
          throw new LinkError('format');
        }
        continue;
      }
      if (this.inString) {
        if (this.escape) {
          this.escape = false;
        } else if (byte === 0x5c) {
          this.escape = true;
        } else if (byte === 0x22) {
          this.inString = false;
        }
        continue;
      }
      if (byte === 0x22) {
        this.inString = true;
      } else if (byte === 0x7b || byte === 0x5b) {
        this.depth += 1;
      } else if (byte === 0x7d || byte === 0x5d) {
        this.depth -= 1;
        if (this.depth === 0) {
          const slice = chunk.subarray(start, i + 1);
          this.size += slice.length;
          if (this.size > this.objectBytes) {
            throw new LinkError('tooLarge');
          }
          this.parts.push(slice);
          out.push(Buffer.concat(this.parts).toString('utf8'));
          this.parts = [];
          this.size = 0;
          start = -1;
        }
      }
    }
    if (this.depth > 0 && start >= 0) {
      const slice = chunk.subarray(start);
      this.size += slice.length;
      if (this.size > this.objectBytes) {
        throw new LinkError('tooLarge');
      }
      this.parts.push(slice);
    }
    return out;
  }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * One object of the bridge: `{ keepalive: true }`, `{ id, result }`,
 * `{ id, error: { code } }`, or undefined when it is none of those.
 */
export function parseObject(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isObject(data)) {
    return undefined;
  }
  if (Object.hasOwn(data, 'keepalive') && !Object.hasOwn(data, 'id')) {
    return { keepalive: true };
  }
  const id = data.id;
  if (!Number.isSafeInteger(id)) {
    return undefined;
  }
  if (Object.hasOwn(data, 'error') && data.error !== null && data.error !== undefined) {
    const code =
      isObject(data.error) && Number.isSafeInteger(data.error.code) ? data.error.code : null;
    // The message of the bridge is never kept: it is not needed, and nothing
    // proves it never repeats the request.
    return { id, error: { code } };
  }
  return { id, result: Object.hasOwn(data, 'result') ? data.result : null };
}

/** A text read from the bridge, without control characters, trimmed and cut. */
export function cleanText(value, max = LIMITS.name) {
  if (typeof value !== 'string') {
    return '';
  }
  let out = '';
  for (const char of value.slice(0, max * 2)) {
    const code = char.codePointAt(0);
    if (code >= 0x20 && code !== 0x7f && !(code >= 0x80 && code <= 0x9f)) {
      out += char;
    }
  }
  return out.trim().slice(0, max);
}

/**
 * The shades of `mylink.status.info`: `[{ id, name, type }]`, valid ids only,
 * no duplicate, at most LIMITS.shades. `type`: 0 blind, 1 shutter on the
 * bridges seen by pysomfymylink, null when absent.
 */
export function parseShades(result) {
  if (!Array.isArray(result)) {
    return undefined;
  }
  const shades = new Map();
  for (const entry of result.slice(0, LIMITS.shades * 4)) {
    if (!isObject(entry) || typeof entry.targetID !== 'string' || !TARGET_ID.test(entry.targetID)) {
      continue;
    }
    if (shades.has(entry.targetID) || shades.size >= LIMITS.shades) {
      continue;
    }
    shades.set(entry.targetID, {
      id: entry.targetID,
      name: cleanText(entry.name),
      type:
        Number.isSafeInteger(entry.type) && entry.type >= 0 && entry.type < 100 ? entry.type : null,
    });
  }
  return [...shades.values()];
}

/** The scenes of `mylink.scene.list`: `[{ id, name }]` (id as a string), at most LIMITS.scenes. */
export function parseScenes(result) {
  if (!Array.isArray(result)) {
    return undefined;
  }
  const scenes = new Map();
  for (const entry of result.slice(0, LIMITS.scenes * 4)) {
    if (!isObject(entry)) {
      continue;
    }
    const raw = entry.sceneID;
    const id =
      typeof raw === 'number' && Number.isSafeInteger(raw)
        ? String(raw)
        : typeof raw === 'string'
          ? raw
          : '';
    if (!SCENE_ID.test(id) || scenes.has(id) || scenes.size >= LIMITS.scenes) {
      continue;
    }
    scenes.set(id, { id, name: cleanText(entry.name) });
  }
  return [...scenes.values()];
}
