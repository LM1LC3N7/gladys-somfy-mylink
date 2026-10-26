// -----------------------------------------------------------------------------
// The messages of the MyLink Synergy API: requests, the cutting of the stream
// into objects (bounded, one pass), the answers, the lists, the System ID.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ObjectScanner,
  encodeRequest,
  normalizeSystemId,
  parseObject,
  parseScenes,
  parseShades,
  refusedMarker,
} from '../src/mylink/protocol.js';

test('a request carries the method, the params and the System ID in params.auth', () => {
  const bytes = encodeRequest(7, 'mylink.move.up', { targetID: 'CC0000A.1' }, 'abc');
  assert.deepEqual(JSON.parse(bytes.toString('utf8')), {
    id: 7,
    method: 'mylink.move.up',
    params: { targetID: 'CC0000A.1', auth: 'abc' },
  });
});

test('the scanner cuts objects glued together, split anywhere, with braces in strings', () => {
  const text =
    '{"keepalive":1}{"jsonrpc":"2.0","result":[{"targetID":"A.1","name":"a } \\" {"}],"id":3}\n{"id":4,"result":true}';
  const bytes = Buffer.from(text, 'utf8');
  for (let cut = 1; cut < bytes.length; cut += 1) {
    const scanner = new ObjectScanner();
    const out = [...scanner.push(bytes.subarray(0, cut)), ...scanner.push(bytes.subarray(cut))];
    assert.equal(out.length, 3, `cut at ${cut}`);
    assert.deepEqual(parseObject(out[0]), { keepalive: true });
    assert.equal(JSON.parse(out[1]).result[0].name, 'a } " {');
    assert.deepEqual(parseObject(out[2]), { id: 4, result: true });
  }
});

test('the scanner keeps multi-byte characters whole across chunks', () => {
  const bytes = Buffer.from('{"id":1,"result":[{"targetID":"A.1","name":"Entrée ☀"}]}', 'utf8');
  for (let cut = 1; cut < bytes.length; cut += 1) {
    const scanner = new ObjectScanner();
    const out = [...scanner.push(bytes.subarray(0, cut)), ...scanner.push(bytes.subarray(cut))];
    assert.equal(JSON.parse(out[0]).result[0].name, 'Entrée ☀');
  }
});

test('the scanner is bounded: one object, and the whole connection', () => {
  const scanner = new ObjectScanner({ objectBytes: 100, connectionBytes: 1000 });
  assert.throws(() => scanner.push(Buffer.from(`{"a":"${'x'.repeat(200)}`)), { kind: 'tooLarge' });
  const total = new ObjectScanner({ objectBytes: 100, connectionBytes: 1000 });
  assert.throws(
    () => {
      for (let i = 0; i < 100; i += 1) total.push(Buffer.from('{"keepalive":1}'));
    },
    { kind: 'tooLarge' },
  );
  // An object that never ends is bounded too, chunk after chunk.
  const open = new ObjectScanner({ objectBytes: 100, connectionBytes: 10_000 });
  open.push(Buffer.from('{"a":"'));
  assert.throws(
    () => {
      for (let i = 0; i < 20; i += 1) open.push(Buffer.from('xxxxxxxxxx'));
    },
    { kind: 'tooLarge' },
  );
  assert.throws(() => new ObjectScanner().push(Buffer.from('HTTP/1.1 400')), { kind: 'format' });
});

test('answers: result, error code (the message of the bridge is never kept), unknown shapes', () => {
  assert.deepEqual(
    parseObject('{"id":2,"error":{"code":-32652,"message":"Invalid auth secret"}}'),
    {
      id: 2,
      error: { code: -32652 },
    },
  );
  assert.deepEqual(parseObject('{"id":2,"error":"bad"}'), { id: 2, error: { code: null } });
  assert.equal(parseObject('{"result":true}'), undefined);
  assert.equal(parseObject('{"id":"2","result":true}'), undefined);
  assert.equal(parseObject('[1]'), undefined);
  assert.equal(parseObject('{"id":1'), undefined);
  assert.deepEqual(parseObject('{"id":1}'), { id: 1, result: null });
});

test('shades: valid ids only (never a wildcard), no duplicate, names cleaned, bounded', () => {
  const shades = parseShades([
    { targetID: 'CC0000A.1', name: ' Salon\u0007 ', type: 1 },
    { targetID: 'CC0000A.1', name: 'again' },
    { targetID: '*.*', name: 'all' },
    { targetID: 'CC0000A.*', name: 'star' },
    { targetID: 'CC 0.1', name: 'space' },
    { targetID: 'CC0000A.2\n', name: 'newline' },
    { targetID: 12, name: 'number' },
    { targetID: 'CC0000A.2', type: '1' },
    null,
  ]);
  assert.deepEqual(shades, [
    { id: 'CC0000A.1', name: 'Salon', type: 1 },
    { id: 'CC0000A.2', name: '', type: null },
  ]);
  assert.equal(parseShades({}), undefined);
  const many = Array.from({ length: 300 }, (_, i) => ({ targetID: `A.${i}`, name: 'x' }));
  assert.equal(parseShades(many).length, 64);
});

test('scenes: integer ids only, bounded', () => {
  assert.deepEqual(
    parseScenes([
      { sceneID: 101, name: 'Matin' },
      { sceneID: '102', name: 'Soir' },
      { sceneID: -1 },
      { sceneID: 1.5 },
      { sceneID: '1e3' },
      { sceneID: 101, name: 'again' },
    ]),
    [
      { id: '101', name: 'Matin' },
      { id: '102', name: 'Soir' },
    ],
  );
  assert.equal(parseScenes(null), undefined);
});

test('System ID: printable characters only, 64 at most, never a control character', () => {
  assert.equal(normalizeSystemId('  mylink123 '), 'mylink123');
  assert.equal(normalizeSystemId(''), undefined);
  assert.equal(normalizeSystemId('a b'), undefined);
  assert.equal(normalizeSystemId('abc\r\n'), 'abc');
  assert.equal(normalizeSystemId('ab\ncd'), undefined);
  assert.equal(normalizeSystemId('é'), undefined);
  assert.equal(normalizeSystemId('x'.repeat(65)), undefined);
  assert.equal(normalizeSystemId(42), undefined);
});

test('the refused marker proves nothing about the System ID: 8 bits, many candidates each', () => {
  const marker = refusedMarker('mylinkSecret42');
  assert.match(marker, /^[0-9a-f]{2}$/);
  // A brute force over 4096 candidates finds about 16 that share it.
  let same = 0;
  for (let i = 0; i < 4096; i += 1) {
    if (refusedMarker(`mylink${i}`) === marker) same += 1;
  }
  assert.ok(same >= 4 && same <= 40, `${same} candidates share the marker`);
});
