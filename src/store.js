// -----------------------------------------------------------------------------
// What must survive a restart, in /data (the only writable place of the
// container):
//   - `lastAttemptAt`: when the bridge was last read (written BEFORE the read,
//     at most once a minute), so that a restart never reads sooner than the
//     interval;
//   - `refused`: the marker of a System ID the bridge refused (8 bits of its
//     SHA-256, see src/mylink/protocol.js): no read with it until the System
//     ID changes or "Test the connection" is pressed;
//   - `shades`, `scenes`: the last lists read (ids and names), so that the
//     commands and the Discovery tab work before the first read;
//   - `assumed`: per shade, the last command sent and when (the bridge gives
//     no state: this is all there is to show);
//   - `lost`: per shade, a stop or close that could not be sent (held when
//     the integration stopped): shown "not sent" on the badge, NEVER sent
//     again after a restart.
// Never the System ID. Readable by the container user only (0600).
// -----------------------------------------------------------------------------

import { readFile, rename, writeFile } from 'node:fs/promises';
import { COMMANDS, LIMITS, PROTECTIVE } from './constants.js';
import { SCENE_ID, TARGET_ID, cleanText } from './mylink/protocol.js';

export const STATE_FILE = '/data/somfy-mylink-state.json';

export function fileStore(path = process.env.DATA_FILE || STATE_FILE) {
  // One write at a time: two saves never share the temporary file.
  let chain = Promise.resolve();
  return {
    async load() {
      try {
        const text = await readFile(path, 'utf8');
        return text.length > 64 * 1024 ? null : JSON.parse(text);
      } catch {
        return null;
      }
    },
    save(data) {
      const text = JSON.stringify(data);
      const write = chain.then(async () => {
        const temporary = `${path}.tmp`;
        await writeFile(temporary, text, { mode: 0o600 });
        await rename(temporary, path);
      });
      chain = write.catch(() => {});
      return write;
    },
  };
}

/** For the tests: the same JSON round trip as the file. */
export function memoryStore(initial = null) {
  return {
    data: initial === null ? null : JSON.parse(JSON.stringify(initial)),
    saves: 0,
    async load() {
      return this.data === null ? null : JSON.parse(JSON.stringify(this.data));
    },
    async save(data) {
      this.data = JSON.parse(JSON.stringify(data));
      this.saves += 1;
    },
  };
}

const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const list = (value) => (Array.isArray(value) ? value : []);
const time = (value, now) =>
  Number.isFinite(value) && value > 0 ? Math.min(value, now) : undefined;
const COMMAND_SET = new Set(Object.values(COMMANDS));

/**
 * The persisted state, repaired and bounded: times never in the future (a
 * clock that jumped, a file edited by hand), ids checked like the bridge's.
 */
export function normalizeMemory(raw, now) {
  const data = object(raw);
  const shades = new Map();
  for (const entry of list(data.shades).slice(0, LIMITS.shades * 2)) {
    const s = object(entry);
    if (typeof s.id === 'string' && TARGET_ID.test(s.id) && shades.size < LIMITS.shades) {
      shades.set(s.id, {
        id: s.id,
        name: cleanText(s.name),
        type: Number.isSafeInteger(s.type) && s.type >= 0 && s.type < 100 ? s.type : null,
      });
    }
  }
  const scenes = new Map();
  for (const entry of list(data.scenes).slice(0, LIMITS.scenes * 2)) {
    const s = object(entry);
    if (typeof s.id === 'string' && SCENE_ID.test(s.id) && scenes.size < LIMITS.scenes) {
      scenes.set(s.id, { id: s.id, name: cleanText(s.name) });
    }
  }
  const assumed = new Map();
  for (const [id, entry] of Object.entries(object(data.assumed)).slice(0, LIMITS.shades * 2)) {
    const a = object(entry);
    const at = time(a.at, now);
    if (
      TARGET_ID.test(id) &&
      COMMAND_SET.has(a.command) &&
      at !== undefined &&
      assumed.size < LIMITS.shades
    ) {
      assumed.set(id, { command: a.command, at, answer: a.answer === 'ok' ? 'ok' : 'none' });
    }
  }
  // `holds` of older versions is ignored: a held command is never sent again
  // after a restart. Only "not sent" is kept, for the badge.
  const lost = {};
  for (const [id, command] of Object.entries(object(data.lost)).slice(0, LIMITS.shades * 2)) {
    if (TARGET_ID.test(id) && PROTECTIVE.has(command) && Object.keys(lost).length < LIMITS.shades) {
      lost[id] = command;
    }
  }
  return {
    lastAttemptAt: time(data.lastAttemptAt, now) ?? 0,
    refused:
      typeof data.refused === 'string' && /^[0-9a-f]{2}$/.test(data.refused) ? data.refused : null,
    shades: [...shades.values()],
    scenes: [...scenes.values()],
    listedAt: time(data.listedAt, now) ?? null,
    assumed: Object.fromEntries(assumed),
    lost,
  };
}
