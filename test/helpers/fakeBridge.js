// -----------------------------------------------------------------------------
// A simulated MyLink bridge on 127.0.0.1 (a real TCP server, never the
// network): it records every request and every connection, checks the System
// ID like the real one (-32652 "Invalid auth"), and answers through a
// handler the test can replace (slow answers, silence, keepalives, errors).
// -----------------------------------------------------------------------------

import { createServer } from 'node:net';
import { ObjectScanner } from '../../src/mylink/protocol.js';

export const SYSTEM_ID = 'mylinkSecret42';
export const SHADES = [
  { targetID: 'CC0000A.1', name: 'Salon', type: 1 },
  { targetID: 'CC0000A.2', name: 'Cuisine', type: 0 },
  { targetID: 'CC0000A.3', name: 'Chambre', type: 1 },
  { targetID: 'CC0000A.4', name: 'Bureau', type: 1 },
  { targetID: 'CC0000A.5', name: 'Entrée', type: 1 },
];
export const SCENES = [
  { sceneID: 101, name: 'Matin' },
  { sceneID: 102, name: 'Soir' },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `answer(request, bridge)` -> an object to send (the id is added), or
 * 'silent', or 'close'; it may be async (a slow bridge). Default: the real
 * behaviour (System ID checked, lists, `true` to the moves).
 */
export function defaultAnswer(request, bridge) {
  if (request.params?.auth !== bridge.systemId) {
    return { jsonrpc: '2.0', error: { code: -32652, message: 'Invalid auth' } };
  }
  switch (request.method) {
    case 'mylink.status.info':
      return { jsonrpc: '2.0', result: bridge.shades };
    case 'mylink.scene.list':
      return { jsonrpc: '2.0', result: bridge.scenes };
    case 'mylink.move.up':
    case 'mylink.move.down':
    case 'mylink.move.stop':
    case 'mylink.scene.run':
      return { jsonrpc: '2.0', result: true };
    default:
      return { jsonrpc: '2.0', error: { code: -32601, message: 'Method not found' } };
  }
}

export async function startBridge({ answer = defaultAnswer, port = 0 } = {}) {
  const bridge = {
    systemId: SYSTEM_ID,
    shades: SHADES,
    scenes: SCENES,
    answer,
    /** Requests in arrival order: { method, params, at, conn } */
    requests: [],
    /** Connections: { opened, closed } (performance.now()) */
    connections: [],
    open: 0,
    maxOpen: 0,
    /** The bridge processes one request at a time per connection, like a serial device. */
    serial: true,
    /**
     * 'stream': cuts the stream into objects (like the integration).
     * 'naive': reads everything waiting on the socket at once and
     * JSON.parse()s it, like a simple firmware loop: two requests glued
     * together are dropped, unanswered.
     */
    mode: 'stream',
    /** Requests answered without error (the moves really "transmitted"). */
    executed: [],
    /** Requests in flight on one connection at most (written, not answered yet). */
    inFlight: 0,
    maxInFlight: 0,
    sockets: new Set(),
    port: 0,
    server: undefined,
  };
  const handle = (socket) => {
    const record = { opened: performance.now(), closed: undefined };
    bridge.connections.push(record);
    bridge.open += 1;
    bridge.maxOpen = Math.max(bridge.maxOpen, bridge.open);
    bridge.sockets.add(socket);
    const scanner = new ObjectScanner();
    let chain = Promise.resolve();
    socket.on('error', () => {});
    socket.on('close', () => {
      record.closed = performance.now();
      bridge.open -= 1;
      bridge.sockets.delete(socket);
    });
    let flight = 0;
    const take = (request) => {
      flight += 1;
      bridge.inFlight = flight;
      bridge.maxInFlight = Math.max(bridge.maxInFlight, flight);
      bridge.requests.push({
        method: request.method,
        params: request.params,
        id: request.id,
        at: performance.now(),
        conn: bridge.connections.indexOf(record),
      });
      return async () => {
        const out = await bridge.answer(request, bridge);
        flight -= 1;
        if (out === 'silent' || socket.destroyed) return;
        if (out === 'close') {
          socket.destroy();
          return;
        }
        if (!out.error && out.result !== false) {
          bridge.executed.push({
            method: request.method,
            params: request.params,
            at: performance.now(),
          });
        }
        socket.write(JSON.stringify({ ...out, id: request.id }));
      };
    };
    let waiting = '';
    let busy = false;
    const naive = async () => {
      if (busy) return;
      busy = true;
      while (waiting !== '') {
        const text = waiting;
        waiting = '';
        let request;
        try {
          request = JSON.parse(text);
        } catch {
          bridge.dropped = (bridge.dropped ?? 0) + 1;
          continue;
        }
        await take(request)().catch(() => {});
      }
      busy = false;
    };
    socket.on('data', (chunk) => {
      if (bridge.mode === 'naive') {
        waiting += chunk.toString('utf8');
        // One firmware loop turn: what has arrived by now is read at once.
        setImmediate(() => naive().catch(() => {}));
        return;
      }
      let texts;
      try {
        texts = scanner.push(chunk);
      } catch {
        socket.destroy();
        return;
      }
      for (const text of texts) {
        const reply = take(JSON.parse(text));
        if (bridge.serial) {
          chain = chain.then(reply).catch(() => {});
        } else {
          reply().catch(() => {});
        }
      }
    });
  };
  bridge.listen = async (at = port) => {
    bridge.server = createServer(handle);
    await new Promise((resolve) => bridge.server.listen(at, '127.0.0.1', resolve));
    bridge.port = bridge.server.address().port;
  };
  bridge.halt = async () => {
    for (const socket of bridge.sockets) socket.destroy();
    await new Promise((resolve) => bridge.server.close(() => resolve()));
  };
  bridge.of = (method) => bridge.requests.filter((r) => r.method === method);
  bridge.sleep = sleep;
  await bridge.listen();
  return bridge;
}

/** A port with nothing listening (connection refused), freed right after. */
export async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/**
 * A sped-up REAL clock: performance.now() times `speed`, plus 1 µs at every
 * read (a decision reading the clock twice is caught); timers divided by
 * `speed`. It moves between any two reads, like the real one.
 */
export function speedClock(speed = 10) {
  let drift = 0;
  const origin = performance.now();
  const timers = {
    setTimeout: (fn, ms) => setTimeout(fn, Math.max(0, Number(ms) || 0) / speed),
    clearTimeout: (handle) => clearTimeout(handle),
  };
  return {
    speed,
    timers,
    monotonic: () => (performance.now() - origin) * speed + 1_000_000 + (drift += 0.001),
    now: () => 1_800_000_000_000 + (performance.now() - origin) * speed,
    /** Waits `ms` of the sped-up clock. */
    wait: (ms) => sleep(ms / speed),
    /** Real ms between two performance.now() values, in the sped-up clock. */
    scale: (realMs) => realMs * speed,
  };
}

export const until = async (check, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timeout');
    await sleep(3);
  }
};
