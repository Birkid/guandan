import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SEAT_COUNT,
  createRoom,
  reduce,
  identityOf,
  validateTransactions,
  sanitizeName,
  pickZodiacs,
} from '../src/room-core.js';
import { randomCode, isRoomId, ROOM_ALPHABET } from '../src/ids.js';

/* 固定随机数，保证可复现 */
function seqRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

function seatAll(state, ids = ['p1', 'p2', 'p3', 'p4']) {
  let s = state;
  ids.forEach((id, i) => {
    const r = reduce(s, { t: 'claimSeat', seat: i, name: `玩家${i + 1}` }, { playerId: id });
    assert.equal(r.ok, true, `claimSeat ${i} failed: ${JSON.stringify(r.error)}`);
    s = r.state;
  });
  return s;
}

test('ids: randomCode 只产出合法字符且长度正确', () => {
  const code = randomCode(6, seqRng([0, 0.1, 0.2, 0.3, 0.4, 0.5]));
  assert.equal(code.length, 6);
  for (const ch of code) assert.ok(ROOM_ALPHABET.includes(ch));
  assert.equal(isRoomId(code), true);
  assert.equal(isRoomId('ab12cd'), false); // 小写不合法
  assert.equal(isRoomId('ABC12'), false); // 长度不对
  assert.equal(isRoomId('ABC12O'), false); // O 不在字母表
});

test('createRoom: 4 个空座位 + 互不重复的生肖 + 房主', () => {
  const room = createRoom({ id: 'AB12CD', hostId: 'p1', rng: seqRng([0.5]) });
  assert.equal(room.seats.length, SEAT_COUNT);
  assert.equal(room.seats.every((s) => s.name === null && s.ownerId === null && s.score === 0), true);
  assert.equal(new Set(room.seatZodiacs).size, SEAT_COUNT);
  assert.equal(room.seatZodiacs.every((z) => z >= 0 && z < 12), true);
  assert.equal(room.hostId, 'p1');
  assert.equal(room.status, 'lobby');
  assert.equal(room.version, 0);
});

test('pickZodiacs: 抽取数量与唯一性', () => {
  const z = pickZodiacs(4, seqRng([0.1, 0.9, 0.4, 0.7, 0.2, 0.6, 0.3, 0.8, 0.5, 0.15, 0.85, 0.35]));
  assert.equal(z.length, 4);
  assert.equal(new Set(z).size, 4);
});

test('sanitizeName: 去控制字符 / 压缩空白 / 限长', () => {
  assert.equal(sanitizeName('  张\u0000三  '), '张三');
  assert.equal(sanitizeName('a   b'), 'a b');
  assert.equal(sanitizeName('一二三四五六七八九十十一十二'), '一二三四五六七八九十十一');
  assert.equal(sanitizeName(123), '');
});

test('claimSeat: 占座 / 重名 / 换座', () => {
  let s = createRoom({ id: 'AB12CD', hostId: 'p1' });
  s = reduce(s, { t: 'claimSeat', seat: 0, name: '张三' }, { playerId: 'p1' }).state;
  assert.equal(s.seats[0].name, '张三');
  assert.equal(s.seats[0].ownerId, 'p1');

  const taken = reduce(s, { t: 'claimSeat', seat: 0, name: '李四' }, { playerId: 'p2' });
  assert.equal(taken.ok, false);
  assert.equal(taken.error.code, 'seat_taken');

  const dupName = reduce(s, { t: 'claimSeat', seat: 1, name: '张三' }, { playerId: 'p2' });
  assert.equal(dupName.ok, false);
  assert.equal(dupName.error.code, 'name_taken');

  // 换座：p1 从 0 换到 2，原座位释放
  const moved = reduce(s, { t: 'claimSeat', seat: 2, name: '张三' }, { playerId: 'p1' });
  assert.equal(moved.ok, true);
  assert.equal(moved.state.seats[0].name, null);
  assert.equal(moved.state.seats[2].name, '张三');
});

test('reduce 不修改传入状态（纯函数）', () => {
  const s = createRoom({ id: 'AB12CD', hostId: 'p1' });
  const snapshot = JSON.stringify(s);
  const r = reduce(s, { t: 'claimSeat', seat: 0, name: '张三' }, { playerId: 'p1' });
  assert.equal(r.ok, true);
  assert.equal(JSON.stringify(s), snapshot, '原状态被修改了');
});

test('status: 坐满后从 lobby 变 playing', () => {
  const s = seatAll(createRoom({ id: 'AB12CD', hostId: 'p1' }));
  assert.equal(s.status, 'playing');
});

test('identityOf: 房主 / 座位识别', () => {
  const s = seatAll(createRoom({ id: 'AB12CD', hostId: 'p1' }));
  assert.deepEqual(identityOf(s, 'p1'), { playerId: 'p1', isHost: true, seatIndex: 0 });
  assert.deepEqual(identityOf(s, 'px'), { playerId: 'px', isHost: false, seatIndex: -1 });
});

test('validateTransactions: 各类非法输入', () => {
  assert.equal(validateTransactions([]), 'tx_empty');
  assert.equal(validateTransactions([{ from: 0, to: 0, amount: 10 }]), 'tx_same_seat');
  assert.equal(validateTransactions([{ from: 0, to: 1, amount: 0 }]), 'tx_invalid');
  assert.equal(validateTransactions([{ from: 0, to: 1, amount: -5 }]), 'tx_invalid');
  assert.equal(validateTransactions([{ from: 0, to: 4, amount: 10 }]), 'tx_invalid');
  assert.equal(validateTransactions([{ from: 0, to: 1, amount: 10 }]), null);
});

test('结算：各记各的，提交即生效（无需对方确认）', () => {
  const s = seatAll(createRoom({ id: 'AB12CD', hostId: 'p1' }));
  const r = reduce(s, { t: 'settle', to: 1, amount: 500 }, { playerId: 'p1' });

  assert.equal(r.ok, true);
  assert.equal(r.state.seats[0].score, -500);
  assert.equal(r.state.seats[1].score, 500);
  assert.equal(r.state.history.length, 1);
  assert.deepEqual(r.state.history[0].transactions, [{ from: '玩家1', to: '玩家2', amount: 500 }]);
  assert.equal(r.events.some((e) => e.type === 'settle_applied'), true);
  assert.equal('proposals' in r.state, false, '不再有待确认提案');
});
  

test('结算：不能给自己记分', () => {
  const s = seatAll(createRoom({ id: 'AB12CD', hostId: 'p1' }));
  const r = reduce(s, { t: 'settle', to: 0, amount: 100 }, { playerId: 'p1' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'tx_same_seat');
  assert.equal(r.state.seats[0].score, 0);
});
  

test('结算：对方不在座位上会失败', () => {
  const s = createRoom({ id: 'AB12CD', hostId: 'p1' });
  const seated = reduce(s, { t: 'claimSeat', seat: 0, name: '张三' }, { playerId: 'p1' }).state;
  const r = reduce(seated, { t: 'settle', to: 1, amount: 200 }, { playerId: 'p1' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'tx_invalid');
  assert.equal(r.state.seats[0].score, 0);
});
  

test('结算：未入座不能记分', () => {
  const s = seatAll(createRoom({ id: 'AB12CD', hostId: 'p1' }));
  const r = reduce(s, { t: 'settle', to: 1, amount: 10 }, { playerId: 'zzz' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'not_seated');
});
  

test('advance: 只有房主可换庄/下一局', () => {
  const s = seatAll(createRoom({ id: 'AB12CD', hostId: 'p1' }));
  const denied = reduce(s, { t: 'advance', kind: 'next' }, { playerId: 'p2' });
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'not_host');

  const next = reduce(s, { t: 'advance', kind: 'next' }, { playerId: 'p1' });
  assert.equal(next.ok, true);
  assert.equal(next.state.currentRound, 2);
  assert.equal(next.state.dealerIndex, 1);
  assert.equal(next.state.dealerStreak, 0);
});

test('advance: 指定初始庄家 / 连庄', () => {
  const s = createRoom({ id: 'AB12CD', hostId: 'p1' });
  const initial = reduce(s, { t: 'advance', kind: 'dealer', dealerIndex: 2, initial: true }, { playerId: 'p1' });
  assert.equal(initial.state.dealerIndex, 2);
  assert.equal(initial.state.currentRound, 1, '指定初始庄家不应改变局数');

  const streak = reduce(initial.state, { t: 'advance', kind: 'dealer', dealerIndex: 2 }, { playerId: 'p1' });
  assert.equal(streak.state.dealerStreak, 1);
  assert.equal(streak.state.dealerIndex, 2);

  const change = reduce(streak.state, { t: 'advance', kind: 'dealer', dealerIndex: 0 }, { playerId: 'p1' });
  assert.equal(change.state.dealerIndex, 0);
  assert.equal(change.state.dealerStreak, 0);
});

test('undo: 房主撤销上一笔（按名字回滚）', () => {
  const s0 = seatAll(createRoom({ id: 'AB12CD', hostId: 'p1' }));
  const applied = reduce(s0, { t: 'settle', to: 1, amount: 400 }, { playerId: 'p1' }).state;
  
  assert.equal(applied.seats[1].score, 400);

  const denied = reduce(applied, { t: 'undo' }, { playerId: 'p2' });
  assert.equal(denied.error.code, 'not_host');

  const undone = reduce(applied, { t: 'undo' }, { playerId: 'p1' });
  assert.equal(undone.ok, true);
  assert.equal(undone.state.seats[0].score, 0);
  assert.equal(undone.state.seats[1].score, 0);
  assert.equal(undone.state.history.length, 0);
});

test('reset: 房主清空分数与历史，保留座位', () => {
  let s = seatAll(createRoom({ id: 'AB12CD', hostId: 'p1' }));
  s = reduce(s, { t: 'settle', to: 1, amount: 700 }, { playerId: 'p1' }).state;
  

  const reset = reduce(s, { t: 'reset' }, { playerId: 'p1' });
  assert.equal(reset.ok, true);
  assert.equal(reset.state.history.length, 0);
  assert.equal(reset.state.currentRound, 1);
  assert.equal(reset.state.seats[0].score, 0);
  assert.equal(reset.state.seats[1].score, 0);
  assert.equal(reset.state.seats[0].name, '玩家1', '清空不应踢人');
});

test('join: 房间无房主时首个加入者成为房主', () => {
  const s = createRoom({ id: 'AB12CD', hostId: null });
  const r = reduce(s, { t: 'join' }, { playerId: 'p9' });
  assert.equal(r.ok, true);
  assert.equal(r.changed, true);
  assert.equal(r.state.hostId, 'p9');
});

test('reshuffleZodiacs: 只有房主可换，且仍然唯一', () => {
  const s = seatAll(createRoom({ id: 'AB12CD', hostId: 'p1' }));
  const denied = reduce(s, { t: 'reshuffleZodiacs' }, { playerId: 'p2' });
  assert.equal(denied.error.code, 'not_host');

  const r = reduce(s, { t: 'reshuffleZodiacs', }, { playerId: 'p1', rng: seqRng([0.9, 0.1, 0.5, 0.3, 0.7, 0.2, 0.8, 0.4, 0.6, 0.15, 0.85, 0.35]) });
  assert.equal(r.ok, true);
  assert.equal(new Set(r.state.seatZodiacs).size, 4);
});

test('未知操作返回 bad_action', () => {
  const s = createRoom({ id: 'AB12CD', hostId: 'p1' });
  const r = reduce(s, { t: 'nope' }, { playerId: 'p1' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'bad_action');
});
