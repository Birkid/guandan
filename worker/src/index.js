/**
 * Worker 入口：静态网关 + 房间路由。
 *
 *   POST /api/rooms              → 创建房间，返回 { roomId }
 *   GET  /api/rooms/<ID>         → 读取房间快照（只读，便于扫码后预览）
 *   GET  /api/rooms/<ID>/ws      → WebSocket（Upgrade），进入实时房间
 *   GET  /api/health             → 健康检查
 */
import { randomCode, isRoomId } from './ids.js';

export { RoomDO } from './room-do.js';

function corsHeaders(env, origin) {
  const allowed = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allow = origin && allowed.includes(origin) ? origin : (allowed[0] || '');
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const headers = corsHeaders(env, origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === '/api/health') {
      return Response.json({ ok: true }, { headers });
    }

    // 创建房间
    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const id = randomCode();
      const stub = env.ROOMS.get(env.ROOMS.idFromName(id));
      const res = await stub.fetch(`https://do/api/rooms/${id}/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: typeof body.playerId === 'string' ? body.playerId.slice(0, 64) : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      return Response.json({ roomId: data.roomId || id }, { headers });
    }

    // 读取快照 / WebSocket
    const match = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9]{6})(\/ws)?$/);
    if (match) {
      const id = match[1].toUpperCase();
      if (!isRoomId(id)) return new Response('bad room id', { status: 400, headers });

      const stub = env.ROOMS.get(env.ROOMS.idFromName(id));
      const target = new URL(request.url);
      target.pathname = `/api/rooms/${id}${match[2] ? '/ws' : '/state'}`;
      target.search = '';
      return stub.fetch(new Request(target.toString(), request));
    }

    return new Response('not found', { status: 404, headers });
  },
};
