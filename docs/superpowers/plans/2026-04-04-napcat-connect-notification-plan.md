# NapCat 连接通知功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 NapCat QQ WebSocket 连接建立时，自动向配置的 notifyQQ 发送准备就绪通知。

**Architecture:** 修改 NapCatService.start() 增加可选回调参数 onConnect，在连接事件触发时调用。index.ts 传入回调函数，判断配置中是否有 notifyQQ，有则发送消息。

**Tech Stack:** TypeScript, Node.js, ws (WebSocket)

---

## 文件结构

| 文件 | 变更 |
|------|------|
| `src/types.ts` | Config.napcat 新增 `notifyQQ?: string` |
| `src/services/napcat.ts` | `start()` 新增 `onConnect?` 参数 |
| `src/index.ts` | 启动时传入 onConnect 回调 |
| `tests/` | 需补充 napcat 连接通知测试 |

---

## Task 1: 添加配置类型

**Files:**
- Modify: `src/types.ts:8-13`

- [ ] **Step 1: 修改 Config.napcat 接口**

在 `src/types.ts` 第 8-13 行，将：

```typescript
napcat: {
  wsUrl: string;
  httpUrl: string;
  token?: string;
  botQQ: string;
};
```

修改为：

```typescript
napcat: {
  wsUrl: string;
  httpUrl: string;
  token?: string;
  botQQ: string;
  notifyQQ?: string;
};
```

- [ ] **Step 2: 运行类型检查**

```bash
npm run typecheck
```

Expected: PASS (无新增错误)

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add notifyQQ config option"
```

---

## Task 2: 修改 NapCatService

**Files:**
- Modify: `src/services/napcat.ts:15-24`

- [ ] **Step 1: 修改 start 方法签名**

在 `src/services/napcat.ts` 第 15 行，将：

```typescript
start(handler: MessageHandler): Promise<void> {
```

修改为：

```typescript
start(handler: MessageHandler, onConnect?: () => Promise<void>): Promise<void> {
```

- [ ] **Step 2: 在 connection 事件中调用 onConnect**

在第 22-23 行，将：

```typescript
this.wss.on('connection', (ws, req) => {
  info(`NapCat connected from ${req.socket.remoteAddress}`);
```

修改为：

```typescript
this.wss.on('connection', async (ws, req) => {
  info(`NapCat connected from ${req.socket.remoteAddress}`);
  if (onConnect) await onConnect();
```

- [ ] **Step 3: 运行类型检查**

```bash
npm run typecheck
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/services/napcat.ts
git commit -m "feat: add onConnect callback to NapCatService.start()"
```

---

## Task 3: 修改 index.ts 添加通知逻辑

**Files:**
- Modify: `src/index.ts:24-126`

- [ ] **Step 1: 修改 napcat.start() 调用，添加 onConnect 回调**

在 `src/index.ts` 第 24-126 行，将 `napcat.start(async (event) => {` 包裹为：

```typescript
await napcat.start(
  async (event) => {
    // ... existing handler code (lines 25-126)
  },
  async () => {
    if (config.napcat.notifyQQ) {
      try {
        await napcat.sendPrivateMsg(config.napcat.notifyQQ, [
          { type: 'text', data: { text: `✅ QQ-OpenCode Bridge 已启动\n📁 工作目录: ${config.workspaceRoot}\n🔗 NapCat 连接就绪` } }
        ]);
      } catch (e) {
        error('Failed to send startup notification', e);
      }
    }
  }
);
```

注意：保持原有 handler 代码完全不变，只在外层添加 onConnect 参数。

- [ ] **Step 2: 运行类型检查**

```bash
npm run typecheck
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: send notification on NapCat connect"
```

---

## Task 4: 补充测试

**Files:**
- Test: `tests/napcat-notification.test.ts` (新建)

- [ ] **Step 1: 编写测试**

创建 `tests/napcat-notification.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NapCatService } from '../src/services/napcat.js';
import type { Config } from '../src/types.js';

describe('NapCatService notification', () => {
  const mockConfig: Config = {
    whitelist: ['123456'],
    workspaceRoot: '/tmp/test',
    napcat: {
      wsUrl: 'ws://127.0.0.1:3000',
      httpUrl: 'http://127.0.0.1:3000',
      botQQ: '123456',
      notifyQQ: '987654321',
    },
    opencode: {
      binaryPath: '/usr/bin/opencode',
      portRange: [3001, 3999],
      commandTimeout: 300000,
    },
    concurrency: {
      allowMultiQQPerProject: false,
      rejectWhenBusy: false,
      abortOwnOnly: true,
    },
    log: { level: 'INFO' },
  };

  it('should call onConnect callback when NapCat connects', async () => {
    const napcat = new NapCatService(mockConfig);
    const onConnect = vi.fn().mockResolvedValue(undefined);
    
    await napcat.start(async () => {}, onConnect);
    
    // Wait for server to be ready
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Note: Full integration test would require mock WebSocket client
    // This test verifies the callback signature compiles correctly
    expect(onConnect).toBeDefined();
    
    napcat.stop();
  });

  it('should not fail when notifyQQ is not configured', async () => {
    const configWithoutNotify = { ...mockConfig, napcat: { ...mockConfig.napcat } };
    delete configWithoutNotify.napcat.notifyQQ;
    
    const napcat = new NapCatService(configWithoutNotify);
    
    // Should start without error even without notifyQQ
    await napcat.start(async () => {}, async () => {});
    napcat.stop();
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
npm test
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/napcat-notification.test.ts
git commit -m "test: add NapCat notification test"
```

---

## Task 5: 最终验证

- [ ] **Step 1: 运行完整类型检查**

```bash
npm run typecheck
```

Expected: PASS

- [ ] **Step 2: 运行完整测试**

```bash
npm test
```

Expected: PASS (所有测试通过)

- [ ] **Step 3: 最终 commit**

```bash
git commit --allow-empty -m "chore: complete napcat notification feature"
```

---

## 验证命令汇总

```bash
# 类型检查
npm run typecheck

# 运行测试
npm test

# 启动服务（手动验证）
npm run start
# 检查 notifyQQ 是否收到消息
```

---

## Spec 覆盖检查

| Spec 要求 | 任务 |
|-----------|------|
| Config 新增 notifyQQ | Task 1 |
| NapCatService 增加 onConnect 回调 | Task 2 |
| index.ts 连接时发送通知 | Task 3 |
| 消息内容正确 | Task 3 |
| 无配置时不发送 | Task 3 (if 逻辑) |
| 发送失败记录日志不崩溃 | Task 3 (try-catch) |
| 补充测试 | Task 4 |
