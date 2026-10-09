/**
 * 房间 Durable Object。
 *
 * 职责很小：加载/持久化状态、管理 WebSocket、把消息交给纯函数状态机 room-core，
 * 然后把结果广播给所有连接。所有业务规则都在 room-core.js 里。
 *
 * 安全要点：玩家身份来自 socket attachment（服务端保存），
 * 不信任消息体里的 playerId，避免冒名。
 */
import { DurableObject } from 'cloudflare:workers';
import { createRoom, reduce, identityOf } from './room-core.js';

const STORAGE_KEY = 'room';
const ROOM_TTL_MS = 24 * 60 * 60 * 1000; // 24 小时无活动自动清理

export class RoomDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.state = null;
    this.roomId = null;

    // 首帧前加载状态，避免并发读到空
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get(STORAGE_KEY)) || null;
      if (this.state && this.state.id) this.roomId = this.state.id;
    });

    // 心跳：客户端发 "ping" 直接回 "pong"，不唤醒 DO（省钱）
    try {
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    } catch {
      /* 老运行时忽略 */
    }
  }

  /* ----------------------------- HTTP 路由 ----------------------------- */

  async fetch(request) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean); // ['api','rooms','<ID>','<action>']
    const roomId = (parts[2] || '').toUpperCase();
    const action = parts[3] || '';
    if (roomId) this.roomId = roomId;

    if (action === 'init') {
      const body = await request.json().catch(() => ({}));
      if (!this.state) {
        this.state = createRoom({ id: roomId || 'ROOM00', hostId: body.playerId || null });
        await this.persist();
      } else if (body.playerId && !this.state.hostId) {
        this.state.hostId = body.playerId;
        await this.persist();
      }
      return Response.json({ roomId: this.state.id });
    }

    if (action === 'state') {
      if (!this.state) return Response.json({ error: 'room_not_found' }, { status: 404 });
      return Response.json({ room: this.state });
    }

    if (action === 'ws') {
      if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
        return new Response('expected websocket', { status: 426 });
      }
      if (!this.state) {
        this.state = createRoom({ id: roomId || 'ROOM00' });
        await this.persist();
      }
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('not found', { status: 404 });
  }

  /* ----------------------------- 持久化 ------------------------------ */

  async persist() {
    await this.ctx.storage.put(STORAGE_KEY, this.state);
    await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
  }

  async alarm() {
    if (!this.state) return;
    if (Date.now() - (this.state.updatedAt || 0) < ROOM_TTL_MS) {
      await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
      return;
    }
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.close(1000, 'room expired'); } catch { /* ignore */ }
    }
    this.state = null;
    await this.ctx.storage.deleteAll();
  }

  /* ------------------------- WebSocket 生命周期 ------------------------ */

  async webSocketMessage(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return this.send(ws, { t: 'error', code: 'bad_json', msg: '消息格式错误' });
    }

    if (!this.state) {
      this.state = createRoom({ id: this.roomId || 'ROOM00' });
      await this.persist();
    }

    const t = msg && msg.t;

    // 首次握手：绑定身份（playerId 只在这里从消息体读取一次）
    if (t === 'hello' || t === 'join') {
      const playerId = typeof msg.playerId === 'string' ? msg.playerId.slice(0, 64) : '';
      if (playerId) {
        try { ws.serializeAttachment({ playerId }); } catch { /* ignore */ }
        const r = reduce(this.state, { t: 'join' }, { playerId });
        if (r.ok && r.changed) {
          this.state = r.state;
          await this.persist();
        }
      }
      return this.broadcast([]);
    }

    // 之后一律用 socket attachment 里的身份
    const att = this.attachment(ws);
    const result = reduce(this.state, msg, { playerId: att.playerId || null });
    if (!result.ok) return this.send(ws, { t: 'error', ...result.error });

    if (result.changed) {
      this.state = result.state;
      await this.persist();
    }
    this.broadcast(result.events || []);
  }

  webSocketClose() { this.broadcast([]); }

  webSocketError() { this.broadcast([]); }

  /* ------------------------------- 工具 ------------------------------ */

  attachment(ws) {
    try { return ws.deserializeAttachment() || {}; } catch { return {}; }
  }

  send(ws, payload) {
    try { ws.send(JSON.stringify(payload)); } catch { /* socket 可能已关闭 */ }
  }

  broadcast(events) {
    if (!this.state) return;
    const sockets = this.ctx.getWebSockets();
    const online = new Set();
    const atts = new Map();
    for (const ws of sockets) {
      const att = this.attachment(ws);
      atts.set(ws, att);
      const idx = att.playerId
        ? this.state.seats.findIndex((s) => s.ownerId === att.playerId)
        : -1;
      if (idx >= 0) online.add(idx);
    }
    const onlineArr = this.state.seats.map((_, i) => online.has(i));
    for (const ws of sockets) {
      this.send(ws, {
        t: 'state',
        room: this.state,
        online: onlineArr,
        you: identityOf(this.state, atts.get(ws).playerId || null),
        events,
      });
    }
  }
}
