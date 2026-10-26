// -----------------------------------------------------------------------------
// The app on a REAL moving clock (performance.now, Date.now, setTimeout, time
// sped up 100 times: the 60 s interval lasts 600 ms) and a real local TCP
// server playing the bridge: the reads really start, at 0, the interval and
// twice the interval (never sooner, never a cycle late), with a bounded
// number of timers; a stop clicked in between is written at once.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { MyLinkApp } from '../src/app.js';
import { POLL_INTERVAL, SECOND } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { memoryStore } from '../src/store.js';
import { SYSTEM_ID, startBridge } from './helpers/fakeBridge.js';

const SPEED = 100;

test('real clock: reads at 0, the interval and twice the interval; a stop in between at once', async (t) => {
  const bridge = await startBridge();
  t.after(() => bridge.halt());
  let timersSet = 0;
  const timers = {
    setTimeout(fn, ms) {
      timersSet += 1;
      return setTimeout(fn, Math.max(0, ms) / SPEED);
    },
    clearTimeout: (id) => clearTimeout(id),
  };
  const gladys = createFakeGladys({
    selector: 'somfy-mylink',
    config: {
      bridge_address: `127.0.0.1:${bridge.port}`,
      system_id: SYSTEM_ID,
      poll_interval: POLL_INTERVAL.min,
    },
  });
  const quiet = () => {};
  const app = new MyLinkApp({
    gladys,
    logger: { info: quiet, warn: quiet, error: quiet, debug: quiet },
    store: memoryStore(),
    now: () => Date.now() * SPEED,
    monotonic: () => performance.now() * SPEED,
    timers,
  });
  registerHandlers(gladys, app, undefined);
  const interval = POLL_INTERVAL.min * SECOND;
  const started = performance.now() * SPEED;
  let stopAt;
  try {
    await gladys.connect();
    const until = started + 2.5 * interval;
    let clicked = false;
    while (performance.now() * SPEED < until) {
      if (!clicked && performance.now() * SPEED > started + 1.3 * interval) {
        clicked = true;
        const shade = { external_id: 'ext:somfy-mylink:shade:CC0000A.1', features: [] };
        const feature = { external_id: 'ext:somfy-mylink:shade:CC0000A.1:state' };
        const clickedAt = performance.now();
        const ack = await gladys.fake.setValue(shade, feature, 0);
        assert.equal(ack.success, true, ack.error);
        stopAt = (bridge.of('mylink.move.stop')[0].at - clickedAt) * SPEED;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await app.stop();
  } finally {
    await app.stop();
  }
  const reads = bridge.of('mylink.status.info').map((r) => r.at * SPEED);
  const at = reads.map((x) => Math.round(x - started));
  assert.equal(reads.length, 3, `reads at ${at}`);
  assert.ok(reads[0] - started < interval / 2, `the first read at once: ${at}`);
  for (let i = 1; i < reads.length; i += 1) {
    const gap = reads[i] - reads[i - 1];
    assert.ok(gap >= 0.9 * interval, `never sooner than the interval: ${at}`);
    assert.ok(gap < 1.5 * interval, `on time: ${at}`);
  }
  assert.ok(stopAt < 1000, `stop written ${Math.round(stopAt)} ms after the click`);
  assert.ok(timersSet <= 30, `${timersSet} timers`);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});
