/** @typedef {'generic'} GameMode */
/** @typedef {'circles' | 'orbit'} CardLayout */

const STORAGE_KEY_V4 = 'mj_data_v4';
const STORAGE_KEY_V3 = 'mj_data_v3';

/** 玩家卡片默认布局：四圆并列 */
export const DEFAULT_CARD_LAYOUT = 'circles';

/** 卡片布局可选项 */
export const CARD_LAYOUTS = ['circles', 'orbit'];

/**
 * 归一化任意历史数据到当前结构。
 * 旧版本里的立直/三麻/掼蛋模式字段一律丢弃，统一回到通用模式。
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, unknown>}
 */
export function migrateV3ToV4(raw) {
  const seats = Array.isArray(raw.seats) && raw.seats.length === 4
    ? raw.seats
    : [null, null, null, null];
  return {
    players: Array.isArray(raw.players) ? raw.players : [],
    seats,
    currentRound: raw.currentRound ?? 1,
    dealerIndex: raw.dealerIndex ?? 0,
    dealerStreak: raw.dealerStreak ?? 0,
    history: Array.isArray(raw.history) ? raw.history : [],
    gameMode: 'generic',
    cardLayout: raw.cardLayout === 'orbit' ? 'orbit' : DEFAULT_CARD_LAYOUT,
    seatZodiacs: Array.isArray(raw.seatZodiacs) ? raw.seatZodiacs : null,
  };
}

/**
 * @param {object} state
 */
export function saveGameState(state) {
  localStorage.setItem(STORAGE_KEY_V4, JSON.stringify(state));
}

/**
 * @returns {object | null}
 */
export function loadGameState() {
  const v4 = localStorage.getItem(STORAGE_KEY_V4);
  if (v4) {
    return migrateV3ToV4(JSON.parse(v4));
  }
  const v3 = localStorage.getItem(STORAGE_KEY_V3);
  if (v3) {
    const migrated = migrateV3ToV4(JSON.parse(v3));
    saveGameState(migrated);
    return migrated;
  }
  return null;
}

export function clearGameStorage() {
  localStorage.removeItem(STORAGE_KEY_V4);
  localStorage.removeItem(STORAGE_KEY_V3);
}

export { STORAGE_KEY_V4, STORAGE_KEY_V3 };
