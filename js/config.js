/**
 * 前端运行配置与本地身份。
 *
 * ROOM_SERVER 留空 = 关闭联机房间功能（纯本地模式，行为与现在完全一致）。
 * 部署好 worker 后，把地址填进来即可开启「开房间 / 扫码加入」。
 */

/** 例：'https://guandan-room.<你的账号>.workers.dev' */
export const ROOM_SERVER = 'https://guandan-room.birkid.workers.dev';

export function isRoomEnabled() {
  return typeof ROOM_SERVER === 'string' && /^https?:\/\//.test(ROOM_SERVER);
}

/** 生成 / 解析房间链接（二维码内容就是这个链接） */
export function roomUrl(roomId, base = (typeof location !== 'undefined' ? location.href : 'https://example.com/')) {
  const u = new URL(base);
  u.hash = `room=${roomId}`;
  return u.toString();
}

export function parseRoomFromHash(hash = (typeof location !== 'undefined' ? location.hash : '')) {
  const m = /(?:^|[#&])room=([A-Za-z0-9]{4,12})/.exec(hash || '');
  return m ? m[1].toUpperCase() : null;
}

/* ---------------- 匿名身份（localStorage） ---------------- */

const PLAYER_ID_KEY = 'mj_player_id';
const PLAYER_NAME_KEY = 'mj_player_name';

export function getPlayerId() {
  let id = localStorage.getItem(PLAYER_ID_KEY);
  if (!id) {
    id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `p-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    localStorage.setItem(PLAYER_ID_KEY, id);
  }
  return id;
}

export function getPlayerName() {
  return localStorage.getItem(PLAYER_NAME_KEY) || '';
}

export function setPlayerName(name) {
  localStorage.setItem(PLAYER_NAME_KEY, String(name || '').replace(/\s+/g, ' ').trim().slice(0, 12));
}
