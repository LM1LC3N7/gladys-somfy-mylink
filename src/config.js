// -----------------------------------------------------------------------------
// The configuration: the manifest `config_schema` values, normalized so the
// rest of the code never deals with strings typed in a form. The System ID is
// the only secret: it is kept here and in the bytes of the requests, never in
// a status, a log line or /data.
// -----------------------------------------------------------------------------

import { BRIDGE, POLL_INTERVAL } from './constants.js';
import { normalizeSystemId, refusedMarker } from './mylink/protocol.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULT_CONFIG = {
  bridge_address: '',
  system_id: '',
  poll_interval: POLL_INTERVAL.default,
  language: 'fr',
};

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/**
 * The address typed by the user: an IPv4 address or a host name, with an
 * optional port (44100 by default). A pasted URL is reduced to its host.
 * Credentials in it are refused and never shown; names in .local are refused
 * (mDNS does not resolve in the container). An invalid entry is never shown
 * back (it may be the System ID pasted in the wrong field): only its length.
 * @returns {{ address?: { host: string, port: number }, invalid?: number, credentials?: boolean, local?: boolean }}
 */
export function parseHost(raw) {
  let text = String(raw ?? '').trim();
  if (text === '') {
    return {};
  }
  if (text.includes('@')) {
    return { credentials: true };
  }
  if (text.length > 260) {
    return { invalid: text.length };
  }
  const length = text.length;
  text = text.replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, '');
  const match = /^([^:]+)(?::(\d{1,5}))?$/.exec(text.toLowerCase());
  if (!match) {
    return { invalid: length };
  }
  const [, host, portText] = match;
  const port = portText === undefined ? BRIDGE.port : Number(portText);
  if (port < 1 || port > 65535 || host.length > 253) {
    return { invalid: length };
  }
  if (/\.local\.?$/.test(host)) {
    return { local: true, invalid: length };
  }
  const valid =
    IPV4.test(host) || (!/^[\d.]+$/.test(host) && host.split('.').every((l) => LABEL.test(l)));
  return valid ? { address: { host, port } } : { invalid: length };
}

/** `host` or `host:port` (port 44100 left out). */
export const addressKey = (address) =>
  address ? (address.port === BRIDGE.port ? address.host : `${address.host}:${address.port}`) : '';

/** A number typed in the form: a finite number, or undefined ('' and null are not 0). */
export function numberOf(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && /^\s*-?\d{1,6}(\.\d{1,6})?\s*$/.test(value)) {
    return Number(value);
  }
  return undefined;
}

const bounded = (value, { default: fallback, min, max }) => {
  const number = numberOf(value);
  return number === undefined ? fallback : Math.min(max, Math.max(min, Math.round(number)));
};

/**
 * @returns {{ address?: { host: string, port: number }, key: string,
 *   invalid?: number, local: boolean, credentialsInHost: boolean,
 *   systemId?: string, systemIdInvalid: boolean, marker?: string,
 *   pollInterval: number, language: 'fr'|'en' }}
 */
export function normalizeConfig(raw = {}) {
  const c = { ...DEFAULT_CONFIG };
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (Object.hasOwn(c, key) && value != null) {
      c[key] = value;
    }
  }
  const parsed = parseHost(typeof c.bridge_address === 'string' ? c.bridge_address : '');
  const typed = typeof c.system_id === 'string' ? c.system_id : '';
  const systemId = normalizeSystemId(typed);
  return {
    address: parsed.address,
    key: addressKey(parsed.address),
    invalid: parsed.invalid,
    local: Boolean(parsed.local),
    credentialsInHost: Boolean(parsed.credentials),
    systemId,
    systemIdInvalid: typed.trim() !== '' && !systemId,
    marker: systemId ? refusedMarker(systemId) : undefined,
    pollInterval: bounded(c.poll_interval, POLL_INTERVAL),
    language: c.language === 'en' ? 'en' : 'fr',
  };
}

/** Whether two configurations talk to the same bridge the same way (a change starts over). */
export const sameConnection = (a, b) => a.key === b.key && a.systemId === b.systemId;
