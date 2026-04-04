# NapCat 连接通知功能设计

**日期**: 2026-04-04
**需求**: NapCat QQ 连接上时，给主号发送准备就绪消息

---

## 概述

在 NapCat WebSocket 连接建立时，自动向配置的主号 QQ 发送一条准备就绪通知。

---

## 配置变更

**文件**: `src/types.ts`

```typescript
export interface Config {
  // ...existing fields
  napcat: {
    wsUrl: string;
    httpUrl: string;
    token?: string;
    botQQ: string;
    notifyQQ?: string;  // 新增
  };
  // ...
}
```

**文件**: `config.json` 示例

```json
{
  "napcat": {
    "wsUrl": "ws://127.0.0.1:3000",
    "httpUrl": "http://127.0.0.1:3000",
    "botQQ": "123456789",
    "notifyQQ": "987654321"
  }
}
```

---

## 实现方案

### 修改 `NapCatService`

**文件**: `src/services/napcat.ts`

```typescript
start(handler: MessageHandler, onConnect?: () => Promise<void>): Promise<void>
```

在 `connection` 事件中调用 `onConnect` 回调：

```typescript
this.wss.on('connection', async (ws, req) => {
  info(`NapCat connected from ${req.socket.remoteAddress}`);
  if (onConnect) await onConnect();
  // ...existing handler
});
```

### 修改 `index.ts`

在启动 NapCat 时传入 `onConnect` 回调：

```typescript
await napcat.start(
  async (event) => { /* existing handler */ },
  async () => {
    if (config.napcat.notifyQQ) {
      await napcat.sendPrivateMsg(config.napcat.notifyQQ, [
        { type: 'text', data: { text: '✅ QQ-OpenCode Bridge 已启动\n📁 工作目录: ${config.workspaceRoot}\n🔗 NapCat 连接就绪' } }
      ]);
    }
  }
);
```

---

## 消息内容

```
✅ QQ-OpenCode Bridge 已启动
📁 工作目录: /path/to/workspace
🔗 NapCat 连接就绪
```

---

## 测试要点

1. **无配置** — `notifyQQ` 未配置时，不发送消息（静默跳过）
2. **正常发送** — 配置正确时，成功发送消息
3. **发送失败** — 记录错误日志，不崩溃

---

## 错误处理

- 若 `sendPrivateMsg` 失败，捕获异常并记录日志
- 不影响主服务启动

---

## 验证命令

```bash
npm run typecheck
npm test
```

启动服务后，检查配置的 `notifyQQ` 是否收到消息。
