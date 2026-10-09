# guandan-room

「通用计分器」的联机房间后端：**Cloudflare Workers + Durable Objects**。

一个房间 = 一个 `RoomDO` 实例（单线程权威状态），前端通过 WebSocket 连接，
所有业务规则都在纯函数 `src/room-core.js` 里，可脱离 Cloudflare 单测。

## 结构

```
worker/
├─ wrangler.toml        # Worker / DO / 迁移 / 环境变量 配置
├─ src/
│  ├─ ids.js            # 房间码生成与校验（纯函数）
│  ├─ room-core.js      # 房间状态机（纯函数，核心规则 + 权限）
│  ├─ room-do.js        # Durable Object：socket / storage / 广播
│  └─ index.js          # Worker 入口：路由 + CORS
└─ test/
   └─ room-core.test.js # 单测（node --test，不需要 CF）
```

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/rooms` | 创建房间，body `{ playerId }`，返回 `{ roomId }` |
| GET | `/api/rooms/<ID>` | 读取房间快照（只读预览） |
| GET | `/api/rooms/<ID>/ws` | WebSocket（`Upgrade: websocket`） |
| GET | `/api/health` | 健康检查 |

## WebSocket 协议

客户端 → 服务端（`t` 为动作名）：

| `t` | 参数 | 权限 |
|---|---|---|
| `hello` / `join` | `playerId` | 任意（建立连接身份，只在首帧读一次） |
| `claimSeat` | `seat`, `name` | 任意 |
| `rename` | `name` | 已入座者 |
| `standUp` | `seat?` | 本人或房主 |
| `setOrigin` | `seat`, `origin` | 本人或房主 |
| `propose` | `kind:'settle'`, `payload.transactions[]` | 已入座者 |
| `confirm` | `proposalId` | 提案受影响座位本人 |
| `reject` | `proposalId` | 受影响座位本人或房主 |
| `advance` | `kind:'next'\|'dealer'`, `dealerIndex?`, `initial?` | **仅房主** |
| `undo` | — | **仅房主** |
| `reset` | — | **仅房主** |
| `reshuffleZodiacs` | — | **仅房主** |

服务端 → 客户端：

| `t` | 说明 |
|---|---|
| `state` | `{ room, online, you, events }`，每次变更后全量广播（状态很小） |
| `error` | `{ code, msg }` |

心跳：客户端发字符串 `ping`，DO 自动回 `pong`（不唤醒实例）。

## 权限模型（提案-确认）

结算不会由一个客户端单方面改分：

1. 任一已入座玩家发起 `propose`（可打包多笔交易）；
2. 受影响座位（付款方 + 收款方）**各自** `confirm`；发起人自己那份自动视为已确认；
3. 全部确认后才落账、写历史、广播。

换庄 / 下一局 / 撤销 / 清空 / 换生肖：**仅房主**。

## 本地开发

```bat
cd worker
npm install
npx wrangler dev
```

## 部署

```bat
cd worker
npx wrangler login
npx wrangler deploy
```

部署后会得到形如 `https://guandan-room.<账号>.workers.dev` 的地址，
把它填到前端 `js/config.js` 的 `ROOM_SERVER`。

> 记得把前端域名（如 `https://birkid.github.io`）写进 `wrangler.toml` 的 `ALLOWED_ORIGINS`。

## 单测

```bat
npm test
npm test          # 或在仓库根目录：node --test worker/test/room-core.test.js
```

## 生命周期

房间 24 小时无活动自动清理（`alarm()` + `storage.deleteAll()`）。
