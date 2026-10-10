/**
 * 房间客户端：WebSocket 连接 + 自动重连 + 动作封装。
 *
 * 事件回调：
 *   onState({ t:'state', room, online, you, events })
 *   onError({ code, msg })
 *   onStatus('connecting' | 'online' | 'offline')
 */
import { ROOM_SERVER, getPlayerId } from './config.js';

export function httpBase(server = ROOM_SERVER) {
  return String(server || '').replace(/\/+$/, '');
}

export function wsUrl(server, roomId) {
  const base = httpBase(server).replace(/^http/, 'ws');
  return `${base}/api/rooms/${roomId}/ws`;
}

export class RoomClient {
  constructor({ server = ROOM_SERVER, onState, onError, onStatus } = {}) {
    this.server = server;
    this.onState = onState || (() => {});
    this.onError = onError || (() => {});
    this.onStatus = onStatus || (() => {});
    this.ws = null;
    this.roomId = null;
    this.playerId = getPlayerId();
    this.connected = false;
    this.closedByUser = false;
    this.retry = 0;
    this.retryTimer = null;
  }

  /** 创建房间，返回 roomId */
  async createRoom() {
    const res = await fetch(`${httpBase(this.server)}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: this.playerId }),
    });
    if (!res.ok) throw new Error(`创建房间失败(${res.status})`);
    const data = await res.json();
    if (!data || !data.roomId) throw new Error('创建房间失败：无 roomId');
    return data.roomId;
  }

  connect(roomId) {
    this.roomId = roomId;
    this.closedByUser = false;
    this.openSocket();
  }

  openSocket() {
    clearTimeout(this.retryTimer);
    this.onStatus('connecting');
    let ws;
    try {
      ws = new WebSocket(wsUrl(this.server, this.roomId));
    } catch {
      this.onError({ code: 'ws_fail', msg: '无法连接房间服务' });
      return this.scheduleRetry();
    }
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this.retry = 0;
      this.onStatus('online');
      this.send({ t: 'hello', playerId: this.playerId });
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'state') this.onState(msg);
      else if (msg.t === 'error') this.onError(msg);
    };

    ws.onclose = () => {
      this.connected = false;
      this.onStatus('offline');
      if (!this.closedByUser) this.scheduleRetry();
    };

    ws.onerror = () => { /* onclose 会接手重连 */ };
  }

  scheduleRetry() {
    this.retry = Math.min(this.retry + 1, 6);
    const delay = Math.min(1000 * 2 ** (this.retry - 1), 15000);
    this.retryTimer = setTimeout(() => {
      if (!this.closedByUser) this.openSocket();
    }, delay);
  }

  send(action) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(action));
    return true;
  }

  /* ---------------------------- 动作封装 ---------------------------- */

  claimSeat(seat, name) { return this.send({ t: 'claimSeat', seat, name }); }
  rename(name) { return this.send({ t: 'rename', name }); }
  standUp(seat) { return this.send({ t: 'standUp', seat }); }
  setOrigin(seat, origin) { return this.send({ t: 'setOrigin', seat, origin }); }
  // 各记各的：记录「自己付给对方多少」，提交即生效
  settle(to, amount) { return this.send({ t: 'settle', to, amount }); }
  
  advanceNext() { return this.send({ t: 'advance', kind: 'next' }); }
  advanceDealer(dealerIndex, { initial = false, bumpRound = false } = {}) {
    return this.send({ t: 'advance', kind: 'dealer', dealerIndex, initial, bumpRound });
  }
  undo() { return this.send({ t: 'undo' }); }
  reset() { return this.send({ t: 'reset' }); }
  reshuffleZodiacs() { return this.send({ t: 'reshuffleZodiacs' }); }

  close() {
    this.closedByUser = true;
    clearTimeout(this.retryTimer);
    try { if (this.ws) this.ws.close(); } catch { /* ignore */ }
    this.ws = null;
    this.connected = false;
  }
}
