/**
 * 房间状态机（纯函数，无 DOM / 无 Cloudflare 依赖）。
 *
 * 设计：所有变更都通过 reduce(state, action, ctx) 完成，
 * 返回新状态 + 事件；Durable Object 只负责 socket / storage / 广播。
 * 这样核心规则可以像 js/guandan/rules.js 一样用 node --test 单测。
 *
 * 权限模型（提案-确认）：
 *  - 结算由任一"已入座"玩家发起 → 生成 proposal
 *  - 受影响座位（付款方 + 收款方）各自确认，发起人自己那份自动视为已确认
 *  - 全部确认后才真正落账
 *  - 换庄 / 下一局 / 撤销 / 清空 / 换生肖：仅房主
 */
import { randomCode } from './ids.js';

export const SEAT_COUNT = 4;
export const ZODIAC_COUNT = 12;
export const MAX_NAME_LENGTH = 12;
export const MAX_HISTORY = 500;
export const MAX_TX_PER_PROPOSAL = 8;
export const MAX_PENDING_PROPOSALS = 8;
export const MAX_AMOUNT = 1_000_000_000;
export const PROPOSAL_TTL_MS = 5 * 60 * 1000;

const PROPOSAL_ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function shuffle(list, rng) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 从 12 生肖里抽 count 个互不重复的序号 */
export function pickZodiacs(count = SEAT_COUNT, rng = Math.random) {
  const pool = Array.from({ length: ZODIAC_COUNT }, (_, i) => i);
  return shuffle(pool, rng).slice(0, Math.min(count, ZODIAC_COUNT));
}

/** 名字清洗：去控制字符、压缩空白、限长 */
export function sanitizeName(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

function emptySeat(index) {
  return { index, name: null, ownerId: null, score: 0, origin: 0 };
}

/* ------------------------------------------------------------------ */
/* 构造                                                                */
/* ------------------------------------------------------------------ */

export function createRoom({
  id = randomCode(),
  hostId = null,
  now = Date.now(),
  rng = Math.random,
  seatZodiacs = null,
} = {}) {
  if (typeof id !== 'string' || id.length === 0) throw new Error('room id required');
  return {
    id,
    version: 0,
    status: 'lobby',
    hostId: hostId || null,
    createdAt: now,
    updatedAt: now,
    currentRound: 1,
    dealerIndex: 0,
    dealerStreak: 0,
    seatZodiacs: Array.isArray(seatZodiacs) && seatZodiacs.length === SEAT_COUNT
      ? seatZodiacs.slice()
      : pickZodiacs(SEAT_COUNT, rng),
    seats: Array.from({ length: SEAT_COUNT }, (_, i) => emptySeat(i)),
    history: [],
    proposals: [],
  };
}

/* ------------------------------------------------------------------ */
/* 查询                                                                */
/* ------------------------------------------------------------------ */

export function seatIndexOf(state, playerId) {
  if (!playerId) return -1;
  return state.seats.findIndex((s) => s.ownerId === playerId);
}

export function identityOf(state, playerId) {
  return {
    playerId: playerId || null,
    isHost: Boolean(playerId) && state.hostId === playerId,
    seatIndex: seatIndexOf(state, playerId),
  };
}

/** 座位是否坐满 */
export function isFull(state) {
  return state.seats.every((s) => Boolean(s.name));
}

/* ------------------------------------------------------------------ */
/* 校验                                                                */
/* ------------------------------------------------------------------ */

export function validateTransactions(txs) {
  if (!Array.isArray(txs) || txs.length === 0) return 'tx_empty';
  if (txs.length > MAX_TX_PER_PROPOSAL) return 'tx_too_many';
  for (const t of txs) {
    if (!t || typeof t !== 'object') return 'tx_invalid';
    const { from, to, amount } = t;
    if (!Number.isInteger(from) || from < 0 || from >= SEAT_COUNT) return 'tx_invalid';
    if (!Number.isInteger(to) || to < 0 || to >= SEAT_COUNT) return 'tx_invalid';
    if (from === to) return 'tx_same_seat';
    if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) return 'tx_invalid';
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 内部：落账                                                           */
/* ------------------------------------------------------------------ */

function applySettle(state, txs, now) {
  for (const t of txs) {
    state.seats[t.from].score -= t.amount;
    state.seats[t.to].score += t.amount;
  }
  state.history.unshift({
    time: now,
    round: state.currentRound,
    dealerIndex: state.dealerIndex,
    type: 'manual',
    transactions: txs.map((t) => ({
      from: state.seats[t.from].name,
      to: state.seats[t.to].name,
      amount: t.amount,
    })),
  });
  if (state.history.length > MAX_HISTORY) state.history.length = MAX_HISTORY;
}

function cleanupProposals(state, now) {
  const before = state.proposals.length;
  state.proposals = state.proposals.filter((p) => now - p.createdAt <= PROPOSAL_TTL_MS);
  return state.proposals.length !== before;
}

function syncStatus(state) {
  state.status = isFull(state) ? 'playing' : 'lobby';
}

/* ------------------------------------------------------------------ */
/* 主入口                                                              */
/* ------------------------------------------------------------------ */

/**
 * @param {object} prev 当前房间状态
 * @param {object} action { t, ... }
 * @param {{ playerId?: string|null, now?: number, rng?: () => number }} ctx
 *        playerId 必须由服务端（socket attachment）提供，不可信任消息体内的
 * @returns {{ ok: boolean, state: object, changed: boolean, events: object[], error: {code: string, msg: string} | null }}
 */
export function reduce(prev, action, ctx = {}) {
  const now = ctx.now ?? Date.now();
  const rng = ctx.rng ?? Math.random;
  const playerId = ctx.playerId ?? null;

  const state = structuredClone(prev);
  const events = [];
  let changed = false;

  const fail = (code, msg) => ({ ok: false, state: prev, changed: false, events: [], error: { code, msg } });

  const t = action && typeof action === 'object' ? action.t : null;
  if (!t) return fail('bad_action', '缺少操作类型');

  const mySeat = seatIndexOf(state, playerId);
  const isHost = Boolean(playerId) && state.hostId === playerId;

  switch (t) {
    case 'join': {
      // 仅用于建立连接身份；首个连接若房间无房主，则成为房主
      if (playerId && !state.hostId) {
        state.hostId = playerId;
        changed = true;
      }
      break;
    }

    case 'claimSeat': {
      if (!playerId) return fail('bad_player', '缺少玩家标识');
      const seat = action.seat;
      if (!Number.isInteger(seat) || seat < 0 || seat >= SEAT_COUNT) return fail('seat_invalid', '座位无效');
      const name = sanitizeName(action.name);
      if (!name) return fail('name_required', '请填写名字');
      const target = state.seats[seat];
      if (target.ownerId && target.ownerId !== playerId) return fail('seat_taken', '该座位已被他人占用');
      if (state.seats.some((s, i) => i !== seat && s.name === name && s.ownerId !== playerId)) {
        return fail('name_taken', '该名字已被使用');
      }
      // 若已在别的座位，先让出来（换座）
      const prevSeat = seatIndexOf(state, playerId);
      if (prevSeat >= 0 && prevSeat !== seat) {
        const old = state.seats[prevSeat];
        old.ownerId = null;
        old.name = null;
      }
      target.ownerId = playerId;
      target.name = name;
      changed = true;
      events.push({ type: 'seat_claimed', seat, name });
      break;
    }

    case 'rename': {
      if (mySeat < 0) return fail('not_seated', '请先入座');
      const name = sanitizeName(action.name);
      if (!name) return fail('name_required', '请填写名字');
      if (state.seats.some((s, i) => i !== mySeat && s.name === name)) return fail('name_taken', '该名字已被使用');
      state.seats[mySeat].name = name;
      changed = true;
      events.push({ type: 'seat_renamed', seat: mySeat, name });
      break;
    }

    case 'standUp': {
      const seat = Number.isInteger(action.seat) ? action.seat : mySeat;
      if (seat < 0 || seat >= SEAT_COUNT) return fail('seat_invalid', '座位无效');
      const owner = state.seats[seat].ownerId;
      if (!isHost && owner !== playerId) return fail('forbidden', '无权操作该座位');
      const s = state.seats[seat];
      s.ownerId = null;
      s.name = null;
      s.score = 0;
      s.origin = 0;
      changed = true;
      events.push({ type: 'seat_cleared', seat });
      break;
    }

    case 'setOrigin': {
      const seat = action.seat;
      if (!Number.isInteger(seat) || seat < 0 || seat >= SEAT_COUNT) return fail('seat_invalid', '座位无效');
      if (!isHost && state.seats[seat].ownerId !== playerId) return fail('forbidden', '无权设置该座位');
      const origin = Number.isFinite(action.origin) ? Math.trunc(action.origin) : 0;
      state.seats[seat].origin = Math.max(-MAX_AMOUNT, Math.min(MAX_AMOUNT, origin));
      changed = true;
      events.push({ type: 'origin_set', seat });
      break;
    }

    case 'reshuffleZodiacs': {
      if (!isHost) return fail('not_host', '只有房主可以换生肖');
      state.seatZodiacs = pickZodiacs(SEAT_COUNT, rng);
      changed = true;
      events.push({ type: 'zodiacs_reshuffled' });
      break;
    }

    case 'propose': {
      if (mySeat < 0) return fail('not_seated', '请先入座');
      if (action.kind !== 'settle') return fail('bad_action', '未知的提案类型');
      const txs = action.payload && action.payload.transactions;
      const invalid = validateTransactions(txs);
      if (invalid) return fail(invalid, '结算数据无效');

      const affected = [...new Set(txs.flatMap((x) => [x.from, x.to]))].sort((a, b) => a - b);
      const need = affected;
      const have = need.includes(mySeat) ? [mySeat] : [];
      const proposal = {
        id: typeof action.proposalId === 'string' && action.proposalId
          ? action.proposalId.slice(0, 24)
          : randomCode(10, rng, PROPOSAL_ID_ALPHABET),
        kind: 'settle',
        payload: { transactions: txs.map((x) => ({ from: x.from, to: x.to, amount: x.amount })) },
        need,
        have,
        by: mySeat,
        byPlayerId: playerId,
        createdAt: now,
      };

      if (have.length >= need.length) {
        // 只需自己确认（理论上不会发生，因为 from !== to）——直接生效
        applySettle(state, proposal.payload.transactions, now);
        events.push({ type: 'settle_applied', transactions: proposal.payload.transactions, round: state.currentRound });
      } else {
        if (state.proposals.length >= MAX_PENDING_PROPOSALS) return fail('busy', '待确认操作过多，请稍后再试');
        state.proposals.push(proposal);
        events.push({ type: 'proposal_created', proposalId: proposal.id });
      }
      changed = true;
      break;
    }

    case 'confirm': {
      const idx = state.proposals.findIndex((p) => p.id === action.proposalId);
      if (idx < 0) return fail('proposal_missing', '该操作已失效');
      const p = state.proposals[idx];
      if (mySeat < 0 || !p.need.includes(mySeat)) return fail('forbidden', '你不在此次结算的确认名单中');
      if (!p.have.includes(mySeat)) {
        p.have.push(mySeat);
        changed = true;
        events.push({ type: 'proposal_updated', proposalId: p.id });
      }
      if (p.have.length >= p.need.length) {
        applySettle(state, p.payload.transactions, now);
        state.proposals.splice(idx, 1);
        changed = true;
        events.push({
          type: 'settle_applied',
          transactions: p.payload.transactions,
          round: state.currentRound,
          affected: p.need.slice(),
        });
      }
      break;
    }

    case 'reject': {
      const idx = state.proposals.findIndex((p) => p.id === action.proposalId);
      if (idx < 0) return fail('proposal_missing', '该操作已失效');
      const p = state.proposals[idx];
      if (!isHost && !(mySeat >= 0 && p.need.includes(mySeat))) return fail('forbidden', '无权拒绝');
      state.proposals.splice(idx, 1);
      changed = true;
      events.push({ type: 'proposal_rejected', proposalId: p.id, by: mySeat });
      break;
    }

    case 'advance': {
      if (!isHost) return fail('not_host', '只有房主可以换庄/下一局');
      const kind = action.kind || 'next';
      if (kind === 'next') {
        state.dealerIndex = (state.dealerIndex + 1) % SEAT_COUNT;
        state.dealerStreak = 0;
        state.currentRound += 1;
      } else if (kind === 'dealer') {
        const d = action.dealerIndex;
        if (!Number.isInteger(d) || d < 0 || d >= SEAT_COUNT) return fail('seat_invalid', '座位无效');
        if (action.initial) {
          state.dealerIndex = d;
          state.dealerStreak = 0;
        } else if (d === state.dealerIndex) {
          state.dealerStreak += 1;
        } else {
          state.dealerIndex = d;
          state.dealerStreak = 0;
        }
        if (action.bumpRound) state.currentRound += 1;
      } else {
        return fail('bad_action', '未知操作');
      }
      changed = true;
      events.push({
        type: 'advanced',
        round: state.currentRound,
        dealerIndex: state.dealerIndex,
        dealerStreak: state.dealerStreak,
      });
      break;
    }

    case 'undo': {
      if (!isHost) return fail('not_host', '只有房主可以撤销');
      if (state.history.length === 0) return fail('nothing_to_undo', '没有可撤销的记录');
      const last = state.history.shift();
      const txs = last.transactions || [];
      for (const tx of txs) {
        const fromSeat = state.seats.find((s) => s.name === tx.from);
        const toSeat = state.seats.find((s) => s.name === tx.to);
        if (fromSeat) fromSeat.score += tx.amount;
        if (toSeat) toSeat.score -= tx.amount;
      }
      changed = true;
      events.push({ type: 'undo_applied', transactions: txs });
      break;
    }

    case 'reset': {
      if (!isHost) return fail('not_host', '只有房主可以清空');
      state.currentRound = 1;
      state.dealerIndex = 0;
      state.dealerStreak = 0;
      state.history = [];
      state.proposals = [];
      for (const s of state.seats) {
        s.score = 0;
        s.origin = 0;
      }
      changed = true;
      events.push({ type: 'reset' });
      break;
    }

    default:
      return fail('bad_action', `未知操作：${String(t)}`);
  }

  if (cleanupProposals(state, now)) changed = true;
  syncStatus(state);

  if (changed) {
    state.version = (state.version || 0) + 1;
    state.updatedAt = now;
  }

  return { ok: true, state, changed, events, error: null };
}
