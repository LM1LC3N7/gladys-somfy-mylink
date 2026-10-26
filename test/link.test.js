// -----------------------------------------------------------------------------
// The link to one bridge against a simulated bridge on 127.0.0.1, on a
// sped-up real clock: one connection at a time, protective commands first,
// reads cut by commands, a silent connection cut before a stop (and the new
// one opened only once the old one is closed), retries within the budget,
// nothing written after its deadline.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIMINGS } from '../src/constants.js';
import { Link } from '../src/mylink/link.js';
import {
  SYSTEM_ID,
  defaultAnswer,
  freePort,
  speedClock,
  startBridge,
} from './helpers/fakeBridge.js';

const SPEED = 10;

function linkTo(bridge, clock, { port = bridge?.port, systemId = SYSTEM_ID } = {}) {
  return new Link({
    address: { host: '127.0.0.1', port },
    systemId,
    timers: clock.timers,
    monotonic: clock.monotonic,
    timings: TIMINGS,
  });
}

async function until(check, limit = 5000) {
  const end = performance.now() + limit;
  while (!check()) {
    if (performance.now() > end) throw new Error('until: timeout');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

const settle = (promise) =>
  promise.then(
    (value) => ({ ok: true, value }),
    (err) => ({ ok: false, err }),
  );

test('one request in flight: five closes on a slow bridge (600 ms) leave one after the other', async (t) => {
  const clock = speedClock(SPEED);
  const bridge = await startBridge({
    answer: async (request, b) => {
      await b.sleep(600 / SPEED);
      return defaultAnswer(request, b);
    },
  });
  bridge.mode = 'naive';
  t.after(() => bridge.halt());
  const link = linkTo(bridge, clock);
  t.after(() => link.close());
  const start = performance.now();
  const results = await Promise.all(
    ['CC0000A.1', 'CC0000A.2', 'CC0000A.3', 'CC0000A.4', 'CC0000A.5'].map((id) =>
      settle(link.request('mylink.move.down', { targetID: id }, { kind: 'protective' })),
    ),
  );
  assert.ok(
    results.every((r) => r.ok && r.value === true),
    JSON.stringify(results),
  );
  assert.equal(bridge.maxOpen, 1);
  assert.equal(bridge.maxInFlight, 1, 'never two requests in flight');
  assert.equal(bridge.executed.length, 5, 'none dropped by a naive bridge');
  assert.equal(bridge.dropped ?? 0, 0);
  for (const request of bridge.requests) {
    assert.ok(clock.scale(request.at - start) < TIMINGS.commandSendBy, 'written in time');
    assert.equal(request.params.auth, SYSTEM_ID);
  }
});

test('a slow bridge (1.2 s): a close never cuts the close in flight, every ack is true', async (t) => {
  const clock = speedClock(SPEED);
  const bridge = await startBridge({
    answer: async (request, b) => {
      await b.sleep(1200 / SPEED);
      return defaultAnswer(request, b);
    },
  });
  t.after(() => bridge.halt());
  const link = linkTo(bridge, clock);
  t.after(() => link.close());
  const results = await Promise.all(
    ['CC0000A.1', 'CC0000A.2', 'CC0000A.3'].map((id) =>
      settle(link.request('mylink.move.down', { targetID: id }, { kind: 'protective' })),
    ),
  );
  assert.ok(
    results.every((r) => r.ok && r.value === true),
    JSON.stringify(results.map((r) => (r.ok ? 'ok' : r.err.kind))),
  );
  assert.equal(bridge.connections.length, 1, 'no connection cut');
  assert.deepEqual(
    bridge.requests.map((r) => r.params.targetID),
    ['CC0000A.1', 'CC0000A.2', 'CC0000A.3'],
    'each close written once',
  );
  assert.equal(bridge.maxInFlight, 1);
});

test('a slow bridge (1.5 s): ordinary commands wait for the answers, nothing is cut', async (t) => {
  const clock = speedClock(SPEED);
  const bridge = await startBridge({
    answer: async (request, b) => {
      await b.sleep(1500 / SPEED);
      return defaultAnswer(request, b);
    },
  });
  t.after(() => bridge.halt());
  const link = linkTo(bridge, clock);
  t.after(() => link.close());
  const results = await Promise.all(
    ['CC0000A.1', 'CC0000A.2', 'CC0000A.3', 'CC0000A.4', 'CC0000A.5'].map((id) =>
      settle(link.request('mylink.move.up', { targetID: id }, { kind: 'command' })),
    ),
  );
  const outcomes = results.map((r) => (r.ok ? 'ok' : `${r.err.kind}:${r.err.written}`));
  // 0, 1.5 and 3 s: three written in time, the others refused unsent (never cut).
  assert.deepEqual(outcomes.slice(0, 2), ['ok', 'ok'], String(outcomes));
  assert.ok(
    outcomes.every((o) => o === 'ok' || o === 'late:false'),
    String(outcomes),
  );
  assert.deepEqual(outcomes.slice(3), ['late:false', 'late:false'], String(outcomes));
  assert.equal(bridge.connections.length, 1, 'no connection cut');
  assert.equal(bridge.maxInFlight, 1);
});

test('a stop 500 ms behind a hung connection is cut free by a timer and served on a new one', async (t) => {
  const clock = speedClock(SPEED);
  const bridge = await startBridge();
  bridge.serial = false;
  t.after(() => bridge.halt());
  const hung = new Set();
  bridge.answer = (request, b) => {
    if (request.method === 'mylink.move.up') {
      hung.add(b.requests.at(-1).conn);
      return 'silent';
    }
    return defaultAnswer(request, b);
  };
  const link = linkTo(bridge, clock);
  t.after(() => link.close());
  const up = settle(link.request('mylink.move.up', { targetID: 'CC0000A.1' }));
  await clock.wait(500);
  const start = performance.now();
  const stop = await settle(
    link.request('mylink.move.stop', { targetID: 'CC0000A.1' }, { kind: 'protective' }),
  );
  assert.equal(stop.ok, true, JSON.stringify(stop));
  const took = clock.scale(performance.now() - start);
  assert.ok(took >= 400 && took < 1500, `served ${Math.round(took)} ms after the click`);
  assert.equal(bridge.of('mylink.move.stop')[0].conn, 1);
  assert.equal((await up).err.written, true);
  assert.equal(bridge.maxOpen, 1);
});

test('an answer `result: false` is never taken as accepted', async (t) => {
  const clock = speedClock(SPEED);
  const bridge = await startBridge({ answer: () => ({ result: false }) });
  t.after(() => bridge.halt());
  const link = linkTo(bridge, clock);
  t.after(() => link.close());
  const r = await settle(link.request('mylink.move.up', { targetID: 'CC0000A.1' }));
  assert.equal(r.err.kind, 'unexpected');
  assert.equal(r.err.written, true);
});

test('a protective command is written before the commands waiting', async (t) => {
  const clock = speedClock(SPEED);
  const bridge = await startBridge({
    answer: async (request, b) => {
      await b.sleep(600 / SPEED);
      return defaultAnswer(request, b);
    },
  });
  t.after(() => bridge.halt());
  const link = linkTo(bridge, clock);
  t.after(() => link.close());
  const all = [
    link.request('mylink.move.up', { targetID: 'CC0000A.1' }),
    link.request('mylink.move.up', { targetID: 'CC0000A.2' }),
    link.request('mylink.move.up', { targetID: 'CC0000A.3' }),
  ];
  // Under load the first write may come late: the stop goes in only once it is written.
  await until(() => bridge.requests.length === 1);
  all.push(link.request('mylink.move.stop', { targetID: 'CC0000A.4' }, { kind: 'protective' }));
  await Promise.all(all.map(settle));
  assert.deepEqual(
    bridge.requests.map((r) => r.params.targetID),
    ['CC0000A.1', 'CC0000A.4', 'CC0000A.2', 'CC0000A.3'],
  );
});

test('a read is cut at once by a command; the new connection opens after the old one is closed', async (t) => {
  const clock = speedClock(SPEED);
  const bridge = await startBridge({
    answer: (request, b) =>
      request.method === 'mylink.status.info' ? 'silent' : defaultAnswer(request, b),
  });
  t.after(() => bridge.halt());
  const link = linkTo(bridge, clock);
  t.after(() => link.close());
  const read = settle(link.request('mylink.status.info', { targetID: '*.*' }, { kind: 'read' }));
  await clock.wait(200);
  const start = performance.now();
  const up = await settle(link.request('mylink.move.up', { targetID: 'CC0000A.1' }));
  assert.equal(up.ok, true);
  assert.ok(clock.scale(performance.now() - start) < 500, 'not behind the read');
  const r = await read;
  assert.equal(r.ok, false);
  assert.equal(r.err.kind, 'preempted');
  assert.equal(bridge.connections.length, 2);
  assert.ok(bridge.connections[0].closed <= bridge.connections[1].opened + 1);
  assert.equal(bridge.maxOpen, 1);
});

test('a silent connection is cut before a stop (≥ 1 s without a byte), a new one carries it', async (t) => {
  const clock = speedClock(SPEED);
  let silent = true;
  const bridge = await startBridge({
    answer: (request, b) => (silent ? 'silent' : defaultAnswer(request, b)),
  });
  bridge.serial = false;
  t.after(() => bridge.halt());
  const link = linkTo(bridge, clock);
  t.after(() => link.close());
  const up = settle(link.request('mylink.move.up', { targetID: 'CC0000A.1' }));
  await clock.wait(1200);
  silent = false;
  const start = performance.now();
  const stop = await settle(
    link.request('mylink.move.stop', { targetID: 'CC0000A.1' }, { kind: 'protective' }),
  );
  assert.equal(stop.ok, true, JSON.stringify(stop));
  assert.ok(clock.scale(performance.now() - start) < 1000);
  const u = await up;
  assert.equal(u.ok, false);
  assert.equal(u.err.written, true, 'the open may have left: never "not sent"');
  assert.equal(bridge.connections.length, 2);
  assert.equal(bridge.maxOpen, 1);
  assert.equal(bridge.requests[1].conn, 1);
});

test('a stop is tried again every 250 ms while the bridge refuses connections, within its budget', async (t) => {
  const clock = speedClock(SPEED);
  const port = await freePort();
  const link = linkTo(undefined, clock, { port });
  t.after(() => link.close());
  const stop = settle(
    link.request(
      'mylink.move.stop',
      { targetID: 'CC0000A.1' },
      { kind: 'protective', retry: true, deadline: clock.monotonic() + TIMINGS.commandSendBy },
    ),
  );
  await clock.wait(1000);
  const bridge = await startBridge({ port });
  t.after(() => bridge.halt());
  const r = await stop;
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(bridge.of('mylink.move.stop').length, 1);
});

test('nothing is written after its deadline; a command not written is "not sent"', async (t) => {
  const clock = speedClock(SPEED);
  const port = await freePort();
  const link = linkTo(undefined, clock, { port });
  t.after(() => link.close());
  const up = settle(link.request('mylink.move.up', { targetID: 'CC0000A.1' }));
  const stop = settle(
    link.request(
      'mylink.move.stop',
      { targetID: 'CC0000A.1' },
      { kind: 'protective', retry: true },
    ),
  );
  const [u, s] = await Promise.all([up, stop]);
  assert.equal(u.ok, false);
  assert.equal(u.err.written, false);
  assert.equal(s.ok, false);
  assert.equal(s.err.written, false);
  assert.equal(s.err.kind, 'unreachable');
  // The bridge comes back: nothing old is written.
  const bridge = await startBridge({ port });
  t.after(() => bridge.halt());
  await clock.wait(1000);
  assert.equal(bridge.requests.length, 0);
});

test('beforeSend false cancels right before the bytes; an answer error is kept by kind', async (t) => {
  const clock = speedClock(SPEED);
  const bridge = await startBridge();
  t.after(() => bridge.halt());
  const link = linkTo(bridge, clock);
  t.after(() => link.close());
  const cancelled = await settle(
    link.request('mylink.move.up', { targetID: 'CC0000A.1' }, { beforeSend: () => false }),
  );
  assert.equal(cancelled.err.kind, 'cancelled');
  assert.equal(bridge.requests.length, 0);
  const wrong = linkTo(bridge, clock, { systemId: 'wrong' });
  t.after(() => wrong.close());
  const refused = await settle(wrong.request('mylink.move.up', { targetID: 'CC0000A.1' }));
  assert.equal(refused.err.kind, 'auth');
  assert.equal(refused.err.written, true);
  assert.doesNotMatch(JSON.stringify(refused.err) + refused.err.message, /wrong|Invalid auth/);
});

test('keepalives between answers are skipped; an oversized answer cuts the connection', async (t) => {
  const clock = speedClock(SPEED);
  const bridge = await startBridge();
  t.after(() => bridge.halt());
  bridge.answer = (request, b) => {
    for (const socket of b.sockets) socket.write('{"keepalive":30}\n');
    return request.method === 'mylink.status.info'
      ? { result: [{ targetID: 'A.1', name: 'x'.repeat(70 * 1024) }] }
      : defaultAnswer(request, b);
  };
  const link = linkTo(bridge, clock);
  t.after(() => link.close());
  const up = await settle(link.request('mylink.move.up', { targetID: 'CC0000A.1' }));
  assert.equal(up.ok, true);
  const read = await settle(
    link.request('mylink.status.info', { targetID: '*.*' }, { kind: 'read' }),
  );
  assert.equal(read.err.kind, 'tooLarge');
});
