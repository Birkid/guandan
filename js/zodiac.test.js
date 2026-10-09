import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ZODIACS,
  DEFAULT_SEAT_COUNT,
  pickDistinctZodiacs,
  normalizeSeatZodiacs,
  reshuffleZodiacs,
  zodiacEmoji,
  zodiacName,
} from './zodiac.js';

test('ZODIACS 共 12 个，且序号唯一', () => {
  assert.equal(ZODIACS.length, 12);
  assert.equal(new Set(ZODIACS.map((z) => z.name)).size, 12);
  ZODIACS.forEach((z) => assert.equal(typeof z.emoji, 'string'));
});

test('pickDistinctZodiacs 默认抽 4 个且互不重复、全部合法', () => {
  const picked = pickDistinctZodiacs();
  assert.equal(picked.length, DEFAULT_SEAT_COUNT);
  assert.equal(new Set(picked).size, picked.length);
  picked.forEach((v) => assert.ok(v >= 0 && v < ZODIACS.length));
});

test('pickDistinctZodiacs 多次抽取都满足不重复', () => {
  for (let i = 0; i < 200; i++) {
    const picked = pickDistinctZodiacs(4);
    assert.equal(new Set(picked).size, 4);
  }
});

test('pickDistinctZodiacs 使用可注入的随机源（确定性）', () => {
  const seq = [0.9, 0.1, 0.5, 0.2, 0.7, 0.3, 0.8, 0.4, 0.6, 0.05, 0.15];
  let i = 0;
  const rng = () => seq[i++ % seq.length];
  const a = pickDistinctZodiacs(4, rng);
  i = 0;
  const b = pickDistinctZodiacs(4, rng);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, 4);
});

test('pickDistinctZodiacs 上限不超过 12', () => {
  const picked = pickDistinctZodiacs(20);
  assert.equal(picked.length, 12);
  assert.equal(new Set(picked).size, 12);
});

test('normalizeSeatZodiacs: 空值随机补满 4 个不重复', () => {
  const r = normalizeSeatZodiacs(null);
  assert.equal(r.length, 4);
  assert.equal(new Set(r).size, 4);
  r.forEach((v) => assert.ok(Number.isInteger(v) && v >= 0 && v < 12));
});

test('normalizeSeatZodiacs: 保留合法唯一值，修复非法/重复', () => {
  const r = normalizeSeatZodiacs([3, 3, -1, 99]);
  assert.equal(r.length, 4);
  assert.equal(r[0], 3); // 首个 3 保留
  assert.equal(new Set(r).size, 4);
  r.forEach((v) => assert.ok(Number.isInteger(v) && v >= 0 && v < 12));
  assert.equal(r.filter((v) => v === 3).length, 1);
});

test('normalizeSeatZodiacs: 全部合法唯一时原样保留', () => {
  const r = normalizeSeatZodiacs([0, 5, 7, 11]);
  assert.deepEqual(r, [0, 5, 7, 11]);
});

test('normalizeSeatZodiacs: 位数不足时补齐且不重复', () => {
  const r = normalizeSeatZodiacs([7]);
  assert.equal(r.length, 4);
  assert.equal(r[0], 7);
  assert.equal(new Set(r).size, 4);
});

test('reshuffleZodiacs 每次都是 4 个不重复', () => {
  for (let i = 0; i < 50; i++) {
    const r = reshuffleZodiacs();
    assert.equal(r.length, 4);
    assert.equal(new Set(r).size, 4);
  }
});

test('zodiacEmoji / zodiacName 取值正确，越界有兜底', () => {
  assert.equal(zodiacName(0), '鼠');
  assert.equal(zodiacEmoji(11), '🐷');
  assert.equal(zodiacName(999), '');
  assert.equal(typeof zodiacEmoji(999), 'string');
});
