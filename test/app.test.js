// -----------------------------------------------------------------------------
// MyLinkApp with the SDK's fake Gladys, the exact handlers of the container
// (src/handlers.js), a simulated bridge on 127.0.0.1 and a sped-up REAL clock
// (it moves between any two reads, 1 µs more at each read), a memory store.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { MyLinkApp } from '../src/app.js';
import { TIMINGS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { memoryStore } from '../src/store.js';
import {
  SYSTEM_ID,
  defaultAnswer,
  freePort,
  speedClock,
  startBridge,
  until,
} from './helpers/fakeBridge.js';

const SELECTOR = 'somfy-mylink';
const SPEED = 10;
const shadeId = (id, key) => `ext:${SELECTOR}:shade:${id}${key ? `:${key}` : ''}`;
const sceneId = (id, key) => `ext:${SELECTOR}:scene:${id}${key ? `:${key}` : ''}`;

async function setup(
  t,
  {
    bridge,
    port,
    store = memoryStore(),
    devices = [],
    config = {},
    speed = SPEED,
    wait = true,
  } = {},
) {
  if (!bridge && port === undefined) {
    bridge = await startBridge();
  }
  const gladys = createFakeGladys({
    selector: SELECTOR,
    config: {
      bridge_address: `127.0.0.1:${port ?? bridge.port}`,
      system_id: SYSTEM_ID,
      language: 'en',
      ...config,
    },
    devices,
  });
  const logs = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(`${level} ${args.map((a) => a?.message ?? a).join(' ')}`),
    ]),
  );
  const clock = speedClock(speed);
  const app = new MyLinkApp({
    gladys,
    logger,
    store,
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
  });
  registerHandlers(gladys, app, logger);
  await gladys.connect();
  t.after(async () => {
    await app.stop();
    await bridge?.halt().catch(() => {});
  });
  if (wait && bridge) {
    await until(() => app.lastRead !== undefined);
    await until(() => !app.reading);
  }
  return { gladys, app, bridge, logs, store, clock };
}

async function createAll(gladys) {
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(device);
  }
}

const deviceOf = (gladys, externalId) =>
  gladys.fake.devices.find((d) => d.external_id === externalId) ??
  gladys.fake.discoveredDevices.find((d) => d.external_id === externalId);

/** The ack of a command on a shade (`key`: state or favorite) or a scene (run). */
function press(gladys, id, key, value, kind = 'shade') {
  const device = deviceOf(gladys, kind === 'shade' ? shadeId(id) : sceneId(id)) ?? {
    external_id: kind === 'shade' ? shadeId(id) : sceneId(id),
    features: [],
  };
  const feature = device.features.find((f) => f.external_id.endsWith(`:${key}`)) ?? {
    external_id: kind === 'shade' ? shadeId(id, key) : sceneId(id, key),
  };
  return gladys.fake.setValue(device, feature, value);
}

/** A shade device as the user created it (for the tests without a read). */
const createdShade = (id) => ({
  name: id,
  external_id: shadeId(id),
  features: [
    { external_id: shadeId(id, 'state'), category: 'shutter', type: 'state', read_only: false },
  ],
});

const secretFree = (text) => assert.doesNotMatch(text, new RegExp(SYSTEM_ID));

function noSecretAnywhere({ gladys, logs, store }) {
  secretFree(logs.join('\n'));
  secretFree(JSON.stringify(store.data));
  secretFree(JSON.stringify(gladys.fake.connectionStatuses));
  secretFree(JSON.stringify(gladys.fake.discoveredDevices));
  secretFree(JSON.stringify(gladys.fake.transports));
}

test('each shade becomes a shutter (state + favourite), each scene a button; assumed state on the badge', async (t) => {
  const ctx = await setup(t);
  const { gladys, bridge } = ctx;
  const shade = deviceOf(gladys, shadeId('CC0000A.1'));
  assert.equal(shade.name, 'Salon');
  assert.deepEqual(
    shade.features.map((f) => [f.external_id, f.category, f.type, f.read_only, f.has_feedback]),
    [
      [shadeId('CC0000A.1', 'state'), 'shutter', 'state', false, false],
      [shadeId('CC0000A.1', 'favorite'), 'button', 'push', false, false],
    ],
  );
  assert.equal(
    shade.features.some((f) => f.type === 'position'),
    false,
    'RTS: no position to show',
  );
  assert.equal(
    shade.features.some((f) => f.category === 'switch' || f.type === 'binary'),
    false,
  );
  const scene = deviceOf(gladys, sceneId('101'));
  assert.equal(scene.name, 'Scene Matin');
  assert.deepEqual(
    scene.features.map((f) => [f.category, f.type]),
    [['button', 'push']],
  );
  assert.equal(gladys.fake.discoveredDevices.length, 7);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /5 shade\(s\), 2 scene\(s\).*assumed/);
  // The read asked every shade and the scenes, with the System ID in params.auth.
  assert.deepEqual(
    bridge.requests.map((r) => [r.method, r.params.targetID, r.params.auth]),
    [
      ['mylink.status.info', '*.*', SYSTEM_ID],
      ['mylink.scene.list', undefined, SYSTEM_ID],
    ],
  );
  await createAll(gladys);
  await until(() =>
    gladys.fake.transports.some((x) => x.device_external_id === shadeId('CC0000A.1')),
  );
  const badge = gladys.fake.transports.findLast(
    (x) => x.device_external_id === shadeId('CC0000A.1'),
  );
  assert.equal(badge.transport, 'local');
  assert.equal(badge.degraded, true);
  assert.match(badge.message.en, /^Assumed state/);
  assert.match(badge.message.fr, /^État supposé/);
  noSecretAnywhere(ctx);
});

test('close, open, stop, favourite and scene send the RTS orders; the state stays "assumed"', async (t) => {
  const ctx = await setup(t);
  const { gladys, bridge } = ctx;
  await createAll(gladys);
  for (const [id, key, value, kind] of [
    ['CC0000A.1', 'state', -1, 'shade'],
    ['CC0000A.2', 'state', 1, 'shade'],
    ['CC0000A.3', 'state', 0, 'shade'],
    ['CC0000A.4', 'favorite', 1, 'shade'],
    ['102', 'run', 1, 'scene'],
  ]) {
    const ack = await press(gladys, id, key, value, kind);
    assert.equal(ack.success, true, `${id} ${key}: ${ack.error}`);
  }
  assert.deepEqual(
    bridge.requests.slice(2).map((r) => [r.method, r.params.targetID ?? r.params.sceneID]),
    [
      ['mylink.move.down', 'CC0000A.1'],
      ['mylink.move.up', 'CC0000A.2'],
      ['mylink.move.stop', 'CC0000A.3'],
      ['mylink.move.stop', 'CC0000A.4'],
      ['mylink.scene.run', 102],
    ],
  );
  // No state is ever published as a fact: nothing but badges.
  assert.equal(gladys.fake.states.length, 0);
  await until(() =>
    gladys.fake.transports.some(
      (x) => x.device_external_id === shadeId('CC0000A.1') && /"close"/.test(x.message?.en ?? ''),
    ),
  );
  const badge = gladys.fake.transports.findLast(
    (x) => x.device_external_id === shadeId('CC0000A.1'),
  );
  assert.match(
    badge.message.en,
    /Assumed state: last command "close" accepted by the bridge; never confirmed/,
  );
  assert.doesNotMatch(badge.message.en + badge.message.fr, /\bclosed\b|\bfermé\b/);
  assert.equal(ctx.store.data.assumed['CC0000A.1'].command, 'close');
  // Bad values are refused, nothing sent.
  const count = bridge.requests.length;
  for (const value of [2, '', null, true, 'abc']) {
    const ack = await press(gladys, 'CC0000A.1', 'state', value);
    assert.equal(ack.success, false, String(value));
  }
  assert.equal(bridge.requests.length, count);
  noSecretAnywhere(ctx);
});

test('stop and close need no read: sent at the start, bridge list unknown, even with a refused read', async (t) => {
  const bridge = await startBridge({
    answer: (request, b) =>
      request.method === 'mylink.status.info' ? 'close' : defaultAnswer(request, b),
  });
  const ctx = await setup(t, { bridge, wait: false, devices: [createdShade('CC0000A.9')] });
  const { gladys } = ctx;
  const stop = await press(gladys, 'CC0000A.9', 'state', 0);
  assert.equal(stop.success, true, stop.error);
  const close = await press(gladys, 'CC0000A.9', 'state', -1);
  assert.equal(close.success, true, close.error);
  // An open needs the shade in the list read from the bridge.
  const open = await press(gladys, 'CC0000A.9', 'state', 1);
  assert.equal(open.success, false);
  assert.match(open.error, /not in the list/);
  assert.deepEqual(
    bridge.requests.filter((r) => r.method.startsWith('mylink.move')).map((r) => r.method),
    ['mylink.move.stop', 'mylink.move.down'],
  );
  // A wildcard never comes from an external id.
  const all = await press(gladys, '*.*', 'state', 0);
  assert.equal(all.success, false);
  assert.equal(bridge.of('mylink.move.stop').length, 1);
});

test('a refused System ID: kept in /data (8 bits), no more reads, opens refused, stop still sent', async (t) => {
  const bridge = await startBridge();
  bridge.systemId = 'another';
  const ctx = await setup(t, { bridge });
  const { gladys, app, store } = ctx;
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /refused the System ID/);
  assert.match(store.data.refused, /^[0-9a-f]{2}$/);
  assert.equal(app.readTimer, undefined, 'no read planned');
  await createAll(gladys);
  const open = await press(gladys, 'CC0000A.1', 'state', 1);
  assert.equal(open.success, false);
  assert.match(open.error, /refused the System ID/);
  assert.equal(bridge.of('mylink.move.up').length, 0);
  // Stop is still written (the bridge refuses it: told so).
  const stop = await press(gladys, 'CC0000A.1', 'state', 0);
  assert.equal(bridge.of('mylink.move.stop').length, 1);
  assert.equal(stop.success, false);
  // Fixed on the bridge side, the Test button (after its minute) reads and clears the refusal.
  bridge.systemId = SYSTEM_ID;
  const early = await gladys.fake.action('test_connection');
  assert.match(early.data.message.en, /less than a minute ago/);
  await ctx.clock.wait(TIMINGS.testGap);
  const ack = await gladys.fake.action('test_connection');
  assert.match(ack.data.message.en, /^Connected/);
  assert.equal(store.data.refused, null);
  noSecretAnywhere(ctx);
});

test('a new System ID typed after a refusal is read again (no blind replay of the old one)', async (t) => {
  const bridge = await startBridge();
  bridge.systemId = 'another';
  const ctx = await setup(t, { bridge });
  const reads = bridge.of('mylink.status.info').length;
  await ctx.gladys.fake.configUpdated({ ...ctx.gladys.fake.config, system_id: 'another' });
  // Within the minute of the last read: not yet.
  await ctx.clock.wait(TIMINGS.testGap / 2);
  assert.equal(bridge.of('mylink.status.info').length, reads);
  await until(() => bridge.of('mylink.status.info').length > reads, 8000);
  await until(() => ctx.app.lastRead?.ok === true);
  assert.equal(ctx.gladys.fake.connectionStatus.connected, true);
  assert.equal(ctx.store.data.refused, null);
});

test('a close not sent in time is held in memory, then sent when the bridge comes back (5 s after the click)', async (t) => {
  const port = await freePort();
  const store = memoryStore();
  const ctx = await setup(t, { port, store, wait: false, devices: [createdShade('CC0000A.1')] });
  const { gladys, app } = ctx;
  const ack = await press(gladys, 'CC0000A.1', 'state', -1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /Close not confirmed .*5, 12 and 25 s after the click/);
  assert.equal(app.holds.has('CC0000A.1'), true);
  // /data never holds a command to send again: only "not sent".
  await until(() => store.data?.lost?.['CC0000A.1'] === 'close');
  assert.equal(store.data.holds, undefined);
  const bridge = await startBridge({ port });
  t.after(() => bridge.halt());
  await until(() => bridge.of('mylink.move.down').length === 1, 5000);
  await until(() => app.holds.size === 0);
  assert.equal(store.data.assumed['CC0000A.1'].command, 'close');
  await until(() => store.data.lost['CC0000A.1'] === undefined);
  await ctx.clock.wait(30_000);
  assert.equal(bridge.of('mylink.move.down').length, 1, 'once');
  noSecretAnywhere(ctx);
});

test('after a restart a held close is NEVER sent again (legacy holds or "not sent"): badge only', async (t) => {
  const now = speedClock(SPEED).now();
  for (const at of [now - 30_000, now + 3 * 3600_000]) {
    const bridge = await startBridge();
    const store = memoryStore({
      holds: [{ target: 'CC0000A.2', command: 'close', at, tries: 1 }],
      lost: { 'CC0000A.2': 'close' },
    });
    const ctx = await setup(t, { bridge, store, devices: [createdShade('CC0000A.2')] });
    await ctx.clock.wait(30_000);
    assert.equal(bridge.of('mylink.move.down').length, 0, `no close (at ${at - now})`);
    await until(() =>
      ctx.gladys.fake.transports.some(
        (x) =>
          x.device_external_id === shadeId('CC0000A.2') && /not sent/.test(x.message?.en ?? ''),
      ),
    );
    await ctx.app.stop();
  }
});

for (const [back, sent] of [
  [7000, 1],
  [8300, 0],
]) {
  test(`a held stop is never written later than 8 s after the click (bridge back at ${back} ms: ${sent})`, async (t) => {
    const port = await freePort();
    const ctx = await setup(t, { port, wait: false, devices: [createdShade('CC0000A.1')] });
    const clicked = performance.now();
    const ack = await press(ctx.gladys, 'CC0000A.1', 'state', 0);
    assert.equal(ack.success, false);
    assert.match(ack.error, /Stop not sent yet .*until 8 s after the click/);
    await ctx.clock.wait(back - ctx.clock.scale(performance.now() - clicked));
    const bridge = await startBridge({ port });
    t.after(() => bridge.halt());
    await ctx.clock.wait(12_000);
    const stops = bridge.of('mylink.move.stop');
    assert.equal(stops.length, sent);
    for (const stop of stops) {
      assert.ok(ctx.clock.scale(stop.at - clicked) < 8000);
    }
    assert.equal(ctx.app.holds.size, 0);
  });
}

test('a stop written without an answer: acked as a failure, never written twice', async (t) => {
  const ctx = await setup(t);
  const { gladys, bridge } = ctx;
  await createAll(gladys);
  bridge.answer = (request, b) =>
    request.method === 'mylink.move.stop' ? 'silent' : defaultAnswer(request, b);
  const ack = await press(gladys, 'CC0000A.1', 'state', 0);
  assert.equal(ack.success, false);
  assert.match(ack.error, /Stop sent, but the bridge did not answer: check the shade/);
  await ctx.clock.wait(15_000);
  assert.equal(bridge.of('mylink.move.stop').length, 1);
});

test('a close without an answer is written again within its budget, then held', async (t) => {
  const ctx = await setup(t);
  const { gladys, bridge, app } = ctx;
  await createAll(gladys);
  let silent = 3;
  bridge.answer = (request, b) => {
    if (request.method === 'mylink.move.down' && silent > 0) {
      silent -= 1;
      return 'silent';
    }
    return defaultAnswer(request, b);
  };
  const ack = await press(gladys, 'CC0000A.1', 'state', -1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /Close not confirmed \(sent, the bridge did not answer\)/);
  assert.equal(bridge.of('mylink.move.down').length, 3, 'written again within 3.5 s');
  await until(() => app.holds.size === 0, 3000);
  assert.equal(bridge.executed.filter((r) => r.method === 'mylink.move.down').length, 1);
});

test('the newest wins on arrival: an open refused, or a MyLink scene, drops the held close', async (t) => {
  const ctx = await setup(t);
  const { gladys, bridge, app } = ctx;
  await createAll(gladys);
  // a) close held, then open clicked while the bridge is down (refused): no close after it.
  await bridge.halt();
  await until(() => !app.link.conn);
  assert.equal((await press(gladys, 'CC0000A.1', 'state', -1)).success, false);
  assert.equal(app.holds.has('CC0000A.1'), true);
  const open = await press(gladys, 'CC0000A.1', 'state', 1);
  assert.equal(open.success, false);
  assert.equal(app.holds.has('CC0000A.1'), false);
  // b) close held on shade 2, then a MyLink scene launched once the bridge is back.
  assert.equal((await press(gladys, 'CC0000A.2', 'state', -1)).success, false);
  assert.equal(app.holds.has('CC0000A.2'), true);
  await bridge.listen(bridge.port);
  const scene = await press(gladys, '101', 'run', 1, 'scene');
  assert.equal(scene.success, true, scene.error);
  assert.equal(app.holds.size, 0);
  await ctx.clock.wait(30_000);
  assert.equal(bridge.of('mylink.move.down').length, 0);
});

test('order: a stop cancels an older open not written yet; reasons tell the real cause', async (t) => {
  const ctx = await setup(t);
  const { gladys, bridge } = ctx;
  await createAll(gladys);
  bridge.answer = async (request, b) => {
    await b.sleep(600 / SPEED);
    return defaultAnswer(request, b);
  };
  const first = press(gladys, 'CC0000A.2', 'state', 1);
  await ctx.clock.wait(100);
  const open = press(gladys, 'CC0000A.1', 'state', 1);
  const scene = press(gladys, '102', 'run', 1, 'scene');
  await ctx.clock.wait(100);
  const stop = press(gladys, 'CC0000A.3', 'state', 0);
  const stop1 = press(gladys, 'CC0000A.1', 'state', 0);
  const [a, b, c, d, e] = await Promise.all([first, open, scene, stop, stop1]);
  assert.equal(a.success, true, a.error);
  assert.equal(b.success, false);
  assert.match(b.error, /newer stop or close of this shade/);
  assert.equal(c.success, false);
  assert.match(c.error, /arrived after this scene was launched/);
  assert.equal(d.success, true, d.error);
  assert.equal(e.success, true, e.error);
  assert.deepEqual(
    bridge.requests.slice(2).map((r) => [r.method, r.params.targetID]),
    [
      ['mylink.move.up', 'CC0000A.2'],
      ['mylink.move.stop', 'CC0000A.3'],
      ['mylink.move.stop', 'CC0000A.1'],
    ],
  );
});

for (const delay of [300, 900]) {
  test(`"close all" on five shades, naive bridge answering in ${delay} ms: all closed, no success without an answer`, async (t) => {
    const ctx = await setup(t);
    const { gladys, bridge } = ctx;
    await createAll(gladys);
    bridge.mode = 'naive';
    bridge.answer = async (request, b) => {
      await b.sleep(delay / SPEED);
      return defaultAnswer(request, b);
    };
    const ids = ['CC0000A.1', 'CC0000A.2', 'CC0000A.3', 'CC0000A.4', 'CC0000A.5'];
    const acks = await Promise.all(ids.map((id) => press(gladys, id, 'state', -1)));
    const answered = new Set(bridge.executed.map((r) => r.params.targetID));
    for (const [index, ack] of acks.entries()) {
      if (ack.success) {
        assert.ok(answered.has(ids[index]), `${ids[index]} acked without an answer`);
      }
    }
    const closed = () =>
      new Set(
        bridge.executed
          .filter((r) => r.method === 'mylink.move.down')
          .map((r) => r.params.targetID),
      );
    await until(() => closed().size === 5, 8000);
    assert.equal(bridge.dropped ?? 0, 0);
    assert.equal(bridge.maxInFlight, 1);
    assert.equal(bridge.maxOpen, 1);
  });
}

test('a command written without an answer: acked as a failure saying the state is unknown', async (t) => {
  const ctx = await setup(t);
  const { gladys, bridge } = ctx;
  await createAll(gladys);
  bridge.answer = () => 'silent';
  const ack = await press(gladys, 'CC0000A.1', 'state', 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /Sent, but the bridge did not answer: state unknown/);
  assert.equal(ctx.store.data.assumed['CC0000A.1'].answer, 'none');
  await until(() => gladys.fake.transports.some((x) => /did not answer/.test(x.message?.en ?? '')));
});

test('an answer of the bridge to a command clears a refused marker and the unreachable badge', async (t) => {
  const bridge = await startBridge();
  bridge.systemId = 'another';
  const ctx = await setup(t, { bridge });
  await createAll(ctx.gladys);
  assert.match(ctx.store.data.refused, /^[0-9a-f]{2}$/);
  bridge.systemId = SYSTEM_ID;
  const stop = await press(ctx.gladys, 'CC0000A.1', 'state', 0);
  assert.equal(stop.success, true, stop.error);
  await until(() => ctx.store.data.refused === null);
  // No longer refused for the System ID (the list was never read, though).
  const open = await press(ctx.gladys, 'CC0000A.1', 'state', 1);
  assert.match(open.error, /not in the list/);
});

test('reads: never sooner than the interval, nor after a restart; Test and Scan once a minute', async (t) => {
  const store = memoryStore();
  const ctx = await setup(t, { store, config: { poll_interval: 60 } });
  const { gladys, bridge, app } = ctx;
  assert.equal(bridge.of('mylink.status.info').length, 1);
  const ack = await gladys.fake.action('test_connection');
  assert.match(ack.data.message.en, /less than a minute ago/);
  await gladys.fake.scanRequest();
  await gladys.fake.configUpdated({ ...gladys.fake.config });
  await app.connected(() => gladys.getConfig());
  assert.equal(bridge.of('mylink.status.info').length, 1);
  assert.ok(store.data.lastAttemptAt > 0);
  // A restart right after: the kept time holds the next read back.
  const again = await setup(t, { bridge, store, wait: false });
  await ctx.clock.wait(20_000);
  assert.equal(bridge.of('mylink.status.info').length, 1);
  await app.stop();
  await again.app.stop();
});

test('getConfig failing at the start: tried again without end, with a status', async (t) => {
  const bridge = await startBridge();
  t.after(() => bridge.halt());
  const gladys = createFakeGladys({
    selector: SELECTOR,
    config: { bridge_address: `127.0.0.1:${bridge.port}`, system_id: SYSTEM_ID },
  });
  await gladys.connect();
  const clock = speedClock(100);
  const app = new MyLinkApp({
    gladys,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    store: memoryStore(),
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
  });
  t.after(() => app.stop());
  let failures = 2;
  const loader = async () => {
    if (failures > 0) {
      failures -= 1;
      throw new Error('503');
    }
    return gladys.getConfig();
  };
  await app.connected(loader);
  assert.match(gladys.fake.connectionStatus.message.en, /could not be read/);
  await assert.rejects(
    app.setValue(undefined, { external_id: 'ext:somfy-mylink:shade:CC0000A.1:state' }, 0),
    /configuration n’a pas encore été lue/,
  );
  await until(() => app.lastRead?.ok === true, 5000);
  assert.equal(failures, 0);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('an unreachable bridge: status says so and that stop and close still go; badges unreachable', async (t) => {
  const port = await freePort();
  const ctx = await setup(t, { port, wait: false, devices: [createdShade('CC0000A.1')] });
  await until(() => ctx.app.lastRead !== undefined, 5000);
  assert.equal(ctx.gladys.fake.connectionStatus.connected, false);
  assert.match(
    ctx.gladys.fake.connectionStatus.message.en,
    /not reachable \(no connection\).*Stop and close/,
  );
  await until(() => ctx.gladys.fake.transports.length > 0);
  assert.equal(ctx.gladys.fake.transports.at(-1).transport, 'unreachable');
});

test('no address or no System ID: a clear status, commands refused, the field never shown back', async (t) => {
  const gladys = createFakeGladys({
    selector: SELECTOR,
    config: { bridge_address: 'mylinkSecret42 oops', system_id: '', language: 'en' },
  });
  const clock = speedClock(SPEED);
  const app = new MyLinkApp({
    gladys,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    store: memoryStore(),
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
  });
  t.after(() => app.stop());
  registerHandlers(gladys, app, console);
  await gladys.connect();
  const message = gladys.fake.connectionStatus.message;
  assert.match(message.en, /Type the IP address/);
  assert.match(message.en, /\(19 characters\) is not valid/);
  secretFree(JSON.stringify(message));
  const ack = await gladys.fake.setValue(
    createdShade('CC0000A.1'),
    createdShade('CC0000A.1').features[0],
    0,
  );
  assert.equal(ack.success, false);
  assert.match(ack.error, /address or the System ID/);
});
