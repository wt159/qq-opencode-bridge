# QQ-OpenCode Bridge 技术设计文档

**版本**: 1.5  
**日期**: 2026-04-01  
**状态**: Review 修订完成（可实施）

---

## 1. 概述

本项目实现了一个 QQ 机器人到 OpenCode 的桥接服务，使用户能够通过 QQ 消息远程控制 OpenCode 进行代码操作。

### 1.1 核心功能

- 通过 QQ 消息打开和管理多个 OpenCode 项目
- 支持 OpenCode server 暴露的 slash commands（通过 `/oc` 前缀调用），命令列表通过 `/commands` 动态发现
- 命令浏览（`/commands` 查看当前实例支持的 OpenCode 命令）
- 模型切换（`/modes`）
- 交互式命令支持（可中断，可授权）
- 多会话管理（一个 QQ 号绑定一个项目，支持多 QQ 共享同一项目）

### 1.2 技术栈

| 组件 | 技术 | 说明 |
|------|------|------|
| QQ 协议端 | NapCatQQ | OneBot v11/v12 实现 |
| 桥接服务 | TypeScript + Node.js | 主要业务逻辑 |
| OpenCode 通信 | HTTP REST API | OpenCode 服务器 API |
| 消息入口 | WebSocket (反向) | NapCat → Bridge（Bridge 作为 WS 服务端） |
| 消息出口 | HTTP API | Bridge → NapCat（调用 send_private_msg / send_group_msg）|

---

## 2. 系统架构

```
┌──────────────────────────────────────────────────────────────────┐
│                         QQ 客户端                                │
│                                                                  │
│  用户发送: /bind /workspace/project1                              │
│           /run 帮我看看代码                                        │
│           /modes claude-3-5-sonnet                              │
│           /oc init-deep                                         │
│           /abort                                                │
└──────────────────────────┬───────────────────────────────────────┘
                           │ WebSocket (OneBot v11/v12 反向)
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                      NapCat (OneBot 服务端)                       │
│  - 接收 QQ 消息                                                  │
│  - 验证白名单 (QQ 号)                                           │
│  - 反向 WebSocket 推送事件到 Bridge                              │
│                                                                  │
│  配置项:                                                         │
│  - napcat-reverse-ws: ws://localhost:3001 (Bridge WS 服务端口)  │
│  - access-token: (必填，与 NapCat 端一致)                        │
└──────────────────────────┬───────────────────────────────────────┘
                           │ WebSocket 客户端
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                    QQ-OpenCode Bridge                            │
│                                                                  │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐     │
│  │ 会话管理器      │  │ 进程管理器      │  │ 命令解析器      │     │
│  │ SessionMgr     │  │ ProcessMgr     │  │ CommandParser  │     │
│  │                │  │                │  │                │     │
│  │ - QQ → 项目    │  │ - 项目 → 端口  │  │ - /bind        │     │
│  │ - QQ → 模型    │  │ - 项目 → PID  │  │ - /run         │     │
│  │ - QQ → 会话ID  │  │ - 进程生命周期 │  │ - /modes       │     │
│  └────────────────┘  └────────────────┘  │ - /oc <cmd>    │     │
│                                           │ - /abort        │     │
│  ┌────────────────┐  ┌────────────────┐  │ - /ls, /new    │     │
│  │ NapCat WS       │  │ OpenCode HTTP   │  │ - /*           │     │
│  │ - 接收事件     │  │ - REST API      │  └────────────────┘     │
│  │ (Bridge WS 服务) │  │ - 端口: 3001+  │                        │
│  └────────────────┘  └────────────────┘                        │
└──────────────────────────┬───────────────────────────────────────┘
                           │
           ┌────────────────┼────────────────┐
           ▼                ▼                ▼
     ┌──────────┐    ┌──────────┐    ┌──────────┐
     │OpenCode 1 │    │OpenCode 2 │    │OpenCode N │
     │ :3001     │    │ :3002     │    │ :3XXX    │
     │ Session A │    │ Session B │    │ Session N │
     └──────────┘    └──────────┘    └──────────┘
```

---

## 3. 数据结构

### 3.1 配置结构

```typescript
interface Config {
  // QQ 白名单 (允许控制的 QQ 号列表)
  whitelist: string[];
  
  // 项目根目录 (限制可以打开的项目路径)
  workspaceRoot: string;
  
  // NapCat 连接配置
  napcat: {
    // 反向 WebSocket 地址 (连接 NapCat)
    wsUrl: string;
    // HTTP API 地址 (发送消息)
    httpUrl: string;
    // 访问令牌
    token?: string;
    // Bot QQ 号
    botQQ: string;
  };
  
  // OpenCode 配置
  opencode: {
    // opencode 可执行文件路径
    binaryPath: string;
    // 端口分配范围
    portRange: [number, number];
    // 服务器密码 (可选)
    password?: string;
    // 命令执行超时 (毫秒)
    commandTimeout: number;
  };
  
  // 日志配置
  log: {
    level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
    file?: string;
  };
}
```

### 3.2 运行时状态

```typescript
// QQ 会话状态
interface QQSession {
  qq: string;                    // QQ 号
  projectPath: string | null;   // 绑定的项目路径
  projectPort: number | null;    // OpenCode 端口
  sessionId: string | null;     // OpenCode Session ID
  model: string | null;         // 当前模型 (provider/modelID 格式)
  state: SessionState;           // 会话状态机
  runningMessageId: string | null; // 当前正在执行的消息 ID
  createdAt: Date;
  lastActiveAt: Date;
}

// 会话状态机
type SessionState =
  | 'idle'      // 空闲
  | 'running'    // 命令执行中
  | 'permission_pending' // 等待权限确认
  | 'aborting'   // 中断中
  | 'restarting' // 进程重启中
  | 'stopped';   // 已停止

// 项目实例
interface ProjectInstance {
  path: string;                  // 项目路径
  port: number;                  // OpenCode 服务端口
  pid: number;                  // 进程 PID
  startedAt: Date;              // 启动时间
  sessions: Set<string>;        // 使用该实例的 QQ 号
  status: 'running' | 'stopping' | 'stopped';
}

// 多用户并发规则
interface ConcurrencyRule {
  // 同一项目是否允许多个 QQ 同时绑定
  allowMultiQQPerProject: boolean;
  // 同一项目的命令是否串行执行
  serialExecution: boolean;
  // /abort 归属：只能中断自己发起的任务
  abortOwnOnly: boolean;
}
```

---

## 4. 命令协议

### 4.1 绑定与状态管理

| 命令 | 参数 | 说明 | 示例 |
|------|------|------|------|
| `/bind` | `<path>` | 绑定 QQ 会话到项目 | `/bind /home/wtp/workspace/project` |
| `/unbind` | - | 解除绑定 | `/unbind` |
| `/status` | - | 查看当前绑定状态 | `/status` |
| `/list` | - | 列出所有运行中的项目 | `/list` |

### 4.2 项目浏览与管理

| 命令 | 参数 | 说明 | 示例 | 返回示例 |
|------|------|------|------|----------|
| `/ls` | - | 列出 workspaceRoot 下所有项目 | `/ls` | `项目列表:\n1. soundbridge\n2. api-server\n3. web-frontend` |
| `/ls` | `<path>` | 列出指定目录下的项目 | `/ls /home/wtp` | `项目列表:\n1. workspace/soundbridge\n2. workspace/api-server` |
| `/new` | `<name>` | 新建空项目（mkdir + git init） | `/new my-project` | `✅ 项目已创建: /workspace/my-project` |
| `/new` | `<url> <name>` | 从 Git 克隆项目 | `/new https://github.com/user/repo my-project` | `✅ 项目已克隆: /workspace/my-project` |
| `/mkdir` | `<path>` | 创建目录 | `/mkdir new-feature` | `✅ 目录已创建: /workspace/project/new-feature` |
| `/tree` | - | 显示项目目录树（当前绑定项目） | `/tree` | 返回目录结构 |
| `/tree` | `<path>` | 显示指定项目的目录树 | `/tree /workspace/project` | 返回目录结构 |

### 4.3 模型切换

| 命令 | 参数 | 说明 | 示例 |
|------|------|------|------|
| `/modes` | - | 列出所有可用模型 | `/modes` |
| `/modes` | `<name>` | 切换当前模型 | `/modes claude-3-5-sonnet` |

### 4.4 代码执行

| 命令 | 参数 | 说明 | 示例 |
|------|------|------|------|
| `/run` | `<msg>` | 执行自然语言指令 | `/run 帮我看看这个函数` |
| `/abort` | - | 中断正在运行的命令 | `/abort` |

### 4.5 OpenCode 命令

**说明**：`/oc` 路由到 OpenCode server 暴露的 **slash commands**。具体支持哪些命令由 `GET /command` 动态发现，不要在文档中硬编码命令列表。

| 命令 | 参数 | 说明 | 示例 |
|------|------|------|------|
| `/oc <cmd>` | slash command + args | 执行 OpenCode slash command | `/oc init-deep` |
| `/oc` | - | 查看可用命令帮助 | `/oc` 或 `/oc help` |

**路由策略**：使用 `/oc` 前缀明确区分 OpenCode 命令。命令列表由 `GET /command` 运行时获取。

**CLI 命令区别**：CLI 子命令（如 `opencode mcp list`）不属于 slash command，不通过 `/oc` 路由。如有需要另行设计。

### 4.6 进程管理

| 命令 | 参数 | 说明 | 示例 |
|------|------|------|------|
| `/stop` | `<path>` | 关闭指定项目 | `/stop /home/wtp/workspace/project` |
| `/stopall` | - | 关闭所有项目 | `/stopall` |

### 4.7 帮助

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助 |
| `/help <cmd>` | 显示特定命令帮助 |
| `/commands` | 列出所有 OpenCode 可用命令 |

---

## 5. 消息流转

```
┌─────────────────────────────────────────────────────────────────┐
│                        完整消息流程                               │
└─────────────────────────────────────────────────────────────────┘

1. QQ 用户发送消息
   └─ "/run 帮我看看这个函数"
   └─ 群聊: "@Bot /run 帮我看看这个函数"

2. NapCat 接收消息
   └─ 识别私聊或 @Bot 消息

3. Bridge 接收事件 (WebSocket)
   └─ {
        "post_type": "message",
        "message_type": "private",   // 或 "group"
        "user_id": 123456,
        "group_id": 789000,          // 仅群聊时
        "message": [
          { "type": "text", "data": { "text": "/run 帮我看看这个函数" } }
        ]
      }

4. 白名单验证
   └─ user_id in whitelist?
       ├─ 是: 继续
       └─ 否: 静默忽略

5. 消息规范化
   └─ 私聊: 取 message[0].text，以 / 开头
   └─ 群聊: 检测 @Bot，取 Bot 后首个文本，去除 @ segment
   └─ 非命令消息: 静默忽略

6. 命令解析
   └─ 从规范化文本中提取命令前缀
       ├─ "/bind"
       ├─ "/run"
       ├─ "/modes"
       └─ ...

7. 执行逻辑

   Case /bind /path/to/project:
   ├─ 验证路径存在
   ├─ 验证路径在 workspaceRoot 下（规范化路径，防止 .. 逃逸）
   ├─ 启动 OpenCode 实例 (如需要)
   ├─ 创建 OpenCode Session
   ├─ 更新会话表 (QQ → 项目映射)
   └─ 发送确认消息

   Case /run <msg>:
   ├─ 检查绑定状态 → 未绑定则拒绝
   ├─ 检查 state → 非 idle 则拒绝（包含 permission_pending）
   ├─ 设置 state = 'running'
   ├─ 调用 POST /session/:id/message
   ├─ 同步等待响应（或使用 prompt_async + 事件订阅）
   ├─ 执行完成后设置 state = 'idle'
   └─ 发送结果到 QQ

   Case /abort:
   ├─ 检查 state = 'running' 且 runningMessageId 属于当前 QQ
   ├─ 设置 state = 'aborting'
   ├─ 调用 POST /session/:id/abort
   ├─ 设置 state = 'idle'
   └─ 发送中断确认

   Case /modes [model]:
   ├─ 无参数: 调用 GET /config/providers
   │   └─ 格式化返回模型列表
   └─ 有参数:
       ├─ 验证模型存在 (provider/modelID)
       ├─ 更新会话状态 model
       └─ 发送确认

   Case /commands:
   ├─ 调用 GET /command（注意: 不是 session.command）
   └─ 格式化返回命令列表

   Case /oc <cmd>:
   ├─ 解析 OpenCode 命令和参数
   ├─ 调用 POST /session/:id/command
   ├─ 同步等待响应（或使用事件订阅）
   └─ 发送结果到 QQ

   Case /approve /reject:
   ├─ 检查 state = 'permission_pending'
   ├─ 调用 POST /session/:id/permissions/:permissionID
   ├─ 设置 state = 'running' 或 'idle'
   └─ 发送确认

8. 结果返回 (通过 NapCat HTTP API)
   └─ POST /send_private_msg (私聊)
       body: {
         "user_id": 123456,
         "message": "执行结果..."
       }
   └─ POST /send_group_msg (群聊)
       body: {
         "group_id": 789000,
         "message": "执行结果..."
       }
```

### 5.1 消息规范化

由于 NapCat 消息是 segment 数组，需先规范化再解析命令：

```typescript
function normalizeMessage(event: NapCatMessageEvent): string | null {
  // 私聊: 直接取首个 text segment
  if (event.message_type === 'private') {
    const text = event.message.find(s => s.type === 'text')?.data?.text;
    return text?.trim() || null;
  }

  // 群聊: 必须 @Bot，取 @ 后内容
  if (event.message_type === 'group') {
    // 过滤 @ segment，Bot QQ 号 = config.napcat.botQQ
    const atIdx = event.message.findIndex(
      s => s.type === 'at' && s.data?.qq === config.napcat.botQQ
    );
    if (atIdx === -1) return null; // 没有 @Bot，静默忽略

    // 取 @Bot 后的首个 text
    const text = event.message.slice(atIdx + 1).find(s => s.type === 'text')?.data?.text;
    return text?.trim() || null;
  }

  return null;
}
```

### 5.2 多用户并发规则

| 规则 | 说明 |
|------|------|
| 同一项目允许多个 QQ 绑定 | 是（通过 ProjectInstance.sessions） |
| 同一项目命令串行执行 | 是（等待队列） |
| /abort 归属 | 只能中断自己发起的任务 |
| /stop 后其他 QQ | 通知该 QQ 绑定已失效，提示重新 /bind |
| 权限确认归属 | 谁触发 permission_pending，谁负责 /approve |

### 5.3 命令路由实现

```typescript
// Bridge 自己的命令列表
const BRIDGE_COMMANDS = new Set([
  'bind', 'unbind', 'status', 'list',
  'ls', 'new', 'mkdir', 'tree',
  'modes', 'commands',
  'run', 'abort',
  'approve', 'reject',      // 权限确认
  'stop', 'stopall',
  'help'
]);

function parseCommand(input: string) {
  // 匹配 /command 或 /command args 格式
  const match = input.match(/^\/(\S+)(?:\s+(.*))?$/);
  if (!match) return null;

  const [, cmd, args] = match;

  // OpenCode 命令使用 /oc 前缀
  if (cmd === 'oc') {
    const ocArgs = args || '';
    const parts = ocArgs.trim().split(/\s+/);
    const ocCmd = parts[0] || 'help';
    const ocCmdArgs = parts.slice(1).join(' ');
    return { type: 'opencode', command: ocCmd, args: ocCmdArgs };
  }

  if (BRIDGE_COMMANDS.has(cmd)) {
    return { type: 'bridge', command: cmd, args: args || '' };
  }

  return null; // 未知命令
}

// 路由处理
async function handleMessage(message: string, qq: string, isGroup: boolean, groupId?: number) {
  const parsed = parseCommand(message);
  if (!parsed) {
    await sendReply(qq, '未知命令，请输入 /help 查看帮助', isGroup, groupId);
    return;
  }

  if (parsed.type === 'bridge') {
    await handleBridgeCommand(parsed.command, parsed.args, qq, isGroup, groupId);
  } else {
    await handleOpenCodeCommand(parsed.command, parsed.args, qq, isGroup, groupId);
  }
}

// OpenCode slash command 处理
async function handleOpenCodeCommand(
  command: string, args: string,
  qq: string, isGroup: boolean, groupId?: number
) {
  const session = getSession(qq);
  if (!session?.sessionId) {
    await sendReply(qq, '请先使用 /bind <项目路径> 绑定项目', isGroup, groupId);
    return;
  }

  // /oc 或 /oc help → 获取命令列表
  if (!command || command === 'help') {
    // GET /command（注意：不是 session.command）
    const resp = await fetch(`${opencodeUrl}/command`);
    const commands = await resp.json();
    await sendReply(qq, formatCommandsList(commands), isGroup, groupId);
    return;
  }

  // 执行 slash command
  const result = await client.session.command({
    path: { id: session.sessionId },
    body: { command, arguments: args }
  });

  await sendReply(qq, formatResult(result), isGroup, groupId);
}

// 权限确认处理
async function handlePermission(qq: string, approve: boolean, groupId?: number) {
  const session = getSession(qq);
  if (session.state !== 'permission_pending') {
    await sendReply(qq, '当前没有待确认的权限请求', false, groupId);
    return;
  }
  await client.session.permission({
    path: { id: session.sessionId, permissionId: session.pendingPermissionId },
    body: { response: approve ? 'allow' : 'deny' }
  });
  session.state = 'running';
  await sendReply(qq, approve ? '已授权' : '已拒绝', false, groupId);
}
```

---

## 6. OpenCode API 使用

> **注意**：所有 API 均基于 OpenCode 官方文档。本节区分 **server 全局 API** 和 **session 级别 API**。

### 6.1 启动 OpenCode 实例

```typescript
// 通过 Node.js child_process 启动，以项目目录为 cwd
import { spawn } from 'child_process';
import { resolve } from 'path';
import { existsSync } from 'fs';

function startOpenCode(projectPath: string, port: number, password?: string) {
  if (!existsSync(projectPath)) {
    throw new Error(`项目目录不存在: ${projectPath}`);
  }

  const env = {
    ...process.env,
    ...(password ? { OPENCODE_SERVER_PASSWORD: password } : {}),
  };

  const proc = spawn('opencode', ['serve', '--port', String(port), '--hostname', '127.0.0.1'], {
    cwd: projectPath,   // 项目目录通过 cwd 指定，而非 --dir
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.stderr.on('data', (d) => console.error('[opencode]', d.toString()));
  return proc;
}
```

> **⚠️** `opencode serve` 不支持 `--dir` 参数。项目上下文由进程 `cwd` 决定。

### 6.2 发送消息（同步响应模型）

```typescript
// 1. 创建 Session
const session = await client.session.create({
  body: { title: "QQ Session" }
});

// 2. 发送 prompt，等待同步响应
// POST /session/:id/message 是同步阻塞的，直接返回结果
const result = await client.session.prompt({
  path: { id: session.id },
  body: {
    model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" },
    parts: [{ type: "text", text: "帮我看看这个函数" }]
  }
});

// 3. 提取响应内容
const text = result.parts.map(p => p.type === 'text' ? p.text : '').join('');
```

> **流式响应（可选）**：如需流式，可先订阅 `/event` SSE，再用 `POST /session/:id/prompt_async`，按 `messageId` 关联事件。

### 6.3 执行 Slash Command

```typescript
// POST /session/:id/command
// 执行 OpenCode slash command（如 /init-deep, /refactor 等）
const result = await client.session.command({
  path: { id: sessionId },
  body: {
    command: "init-deep",
    arguments: ""
  }
});
```

### 6.4 列出可用 Slash Commands

```typescript
// GET /command（注意：是 server 全局 API，不是 session.command）
// 返回该 OpenCode 实例支持的所有 slash commands 列表
const resp = await fetch(`${opencodeUrl}/command`);
const commands = await resp.json();
// commands: [{ id, name, description }]
```

### 6.5 模型列表

```typescript
// GET /config/providers
const resp = await fetch(`${opencodeUrl}/config/providers`);
const { providers, default: defaults } = await resp.json();
// providers: [{ id, name, models: [...] }]
// defaults: { [providerID]: modelID }
```

### 6.6 中断执行

```typescript
// POST /session/:id/abort
await client.session.abort({
  path: { id: sessionId }
});
```

### 6.7 权限确认

```typescript
// POST /session/:id/permissions/:permissionID
// Bridge 检测到 permission_pending 时调用
await client.session.permission({
  path: { id: sessionId, permissionId: pendingPermissionId },
  body: { response: 'allow', remember: true }
});
```

---

## 7. 错误处理

### 7.1 错误码定义

| 错误码 | 说明 | 返回消息 |
|--------|------|----------|
| `ERR_NO_BIND` | 未绑定项目 | `请先使用 /bind <项目路径> 绑定项目` |
| `ERR_PATH_NOT_FOUND` | 项目不存在 | `项目不存在: /path/to/project` |
| `ERR_PATH_FORBIDDEN` | 路径不在允许范围 | `路径不在允许范围内: /path` |
| `ERR_ALREADY_RUNNING` | 命令正在执行 | `当前有命令正在执行，请稍后或使用 /abort 中断` |
| `ERR_TIMEOUT` | 命令执行超时 | `命令执行超时 (5分钟)` |
| `ERR_START_FAILED` | OpenCode 启动失败 | `项目启动失败，请检查日志` |
| `ERR_MODEL_NOT_FOUND` | 模型不存在 | `模型不存在: xxx，可用 /modes 查看` |
| `ERR_UNKNOWN_CMD` | 未知命令 | `未知命令，请输入 /help 查看` |
| `ERR_NOT_WHITELIST` | 不在白名单 | (静默) |
| `ERR_DIR_EXISTS` | 目录已存在 | `目录已存在: /path/to/dir` |
| `ERR_GIT_CLONE_FAILED` | Git 克隆失败 | `克隆失败: xxx，请检查 URL 是否正确` |
| `ERR_INVALID_PATH` | 无效路径 | `无效的路径: xxx` |

### 7.2 错误恢复策略

| 场景 | 处理策略 |
|------|----------|
| OpenCode 进程崩溃 | 自动重启，最多3次 |
| NapCat 连接断开 | 自动重连，指数退避 |
| 命令执行超时 | 发送超时通知，保留现场 |
| 端口被占用 | 自动选择下一个可用端口 |

---

## 8. 项目结构

```
qq-opencode-bridge/
├── src/
│   ├── index.ts                 # 入口，启动 Bridge
│   ├── config.ts               # 配置加载与验证
│   ├── types.ts                # 类型定义
│   │
│   ├── modules/
│   │   ├── session.ts          # QQ 会话管理
│   │   │                       # - QQ → 项目/模型/Session 映射
│   │   │                       # - 状态更新
│   │   │
│   │   ├── process.ts          # OpenCode 进程管理
│   │   │                       # - 启动/停止 OpenCode
│   │   │                       # - 端口分配
│   │   │                       # - 进程监控
│   │   │
│   │   ├── command.ts          # 命令解析与路由
│   │   │                       # - 解析命令前缀
│   │   │                       # - 参数提取
│   │   │                       # - 路由到处理函数
│   │   │
│   │   ├── filesystem.ts       # 文件系统操作
│   │   │                       # - /ls 列出项目
│   │   │                       # - /new 新建项目 (mkdir + git clone/init)
│   │   │                       # - /mkdir 创建目录
│   │   │                       # - /tree 显示目录树
│   │   │
│   │   └── whitelist.ts       # 白名单验证
│   │                           # - QQ 号验证
│   │                           # - 路径验证
│   │
│   ├── services/
│   │   ├── napcat.ts           # NapCat API 客户端
│   │   │                       # - WebSocket 连接
│   │   │                       # - 发送消息
│   │   │                       # - 事件处理
│   │   │
│   │   ├── opencode.ts         # OpenCode API 客户端
│   │   │                       # - REST API 调用
│   │   │                       # - SSE 事件订阅
│   │   │                       # - Session 管理
│   │   │
│   │   └── process.ts          # 子进程管理
│   │                           # - spawn/kill
│   │                           # - stdout/stderr
│   │
│   └── utils/
│       ├── logger.ts           # 日志工具
│       ├── text.ts             # 文本处理工具
│       └── retry.ts            # 重试工具
│
├── config.example.json          # 配置示例
├── package.json
├── tsconfig.json
├── SPEC.md                     # 本文档
└── README.md
```

---

## 9. 安全考虑

### 9.1 白名单控制

- 只有在 `whitelist` 中配置的 QQ 号才能控制
- 项目路径必须在 `workspaceRoot` 下
- 禁止访问 `workspaceRoot` 之外的文件
- 路径规范化：禁止 `..` 逃逸，必须 `path.resolve()` 后验证前缀

### 9.2 命令限制

- 所有命令通过 OpenCode API 执行，不直接执行 shell 命令
- OpenCode 本身的权限控制生效
- 建议设置 `permissions: auto` 或 `permissions: ask` + `/approve` 命令

### 9.3 通信安全

- `access-token` **必须**配置（两侧一致）
- NapCat WS 和 HTTP 均通过 token 鉴权
- OpenCode 服务绑定到 127.0.0.1
- `/new` 克隆 URL 仅允许 `https://` 开头

### 9.4 端口规划

- Bridge WS 服务端：占用一个独立端口（如 3001）
- OpenCode 实例端口：范围 3002 起（如 3002-3999）
- **禁止混用**：Bridge WS 端口不能与 OpenCode 实例端口重叠

---

## 10. 配置示例

```json
{
  "whitelist": ["123456789", "987654321"],
  "workspaceRoot": "/home/wtp/workspace",
  "napcat": {
    "wsUrl": "ws://localhost:3001",
    "httpUrl": "http://localhost:3000",
    "token": "your-token-here",
    "botQQ": "1111111111"
  },
  "opencode": {
    "binaryPath": "/home/wtp/.opencode/bin/opencode",
    "portRange": [3002, 3999],
    "password": "optional-password",
    "commandTimeout": 300000
  },
  "concurrency": {
    "allowMultiQQPerProject": true,
    "serialExecution": true,
    "abortOwnOnly": true
  },
  "log": {
    "level": "INFO",
    "file": "./bridge.log"
  }
}
```

---

## 11. 实现计划 (待详细规划)

### Phase 1: 基础框架
- [ ] 项目初始化 (TypeScript + Node.js)
- [ ] 配置文件加载
- [ ] NapCat WebSocket 连接
- [ ] 基础命令解析

### Phase 2: OpenCode 集成
- [ ] OpenCode 进程启动
- [ ] OpenCode API 客户端
- [ ] Session 管理
- [ ] 基础 `/bind`, `/unbind`, `/status`

### Phase 3: 命令执行
- [ ] `/run` 命令实现
- [ ] SSE 流式返回
- [ ] `/abort` 中断支持

### Phase 4: 项目管理功能
- [ ] `/ls` 列出项目
- [ ] `/new` 新建项目 (mkdir + git clone/init)
- [ ] `/mkdir` 创建目录
- [ ] `/tree` 显示目录树

### Phase 5: 完整功能
- [ ] `/modes` 模型切换
- [ ] `/oc <cmd>` OpenCode 命令支持
- [ ] `/list`, `/stop`, `/stopall`

### Phase 6: 完善
- [ ] 错误处理完善
- [ ] 日志系统
- [ ] 进程监控与恢复
- [ ] 测试

---

## 12. 参考资料

- [NapCatQQ 文档](https://napneko.github.io/)
- [OpenCode Server API](https://dev.opencode.ai/docs/server)
- [OpenCode SDK](https://opencode.ai/docs/sdk)
- [OneBot v11 标准](https://onebot.dev/)

---

**文档版本历史**

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.5 | 2026-04-01 | **重大修订**：修复 API 错误用法（serve --dir, session.command 列命令）、补全消息规范化、多用户并发规则、状态机、权限确认、端口规划、安全要求 |
| 1.4 | 2026-04-01 | Review 修复：更新架构图、核心功能描述、消息流转中的 OpenCode 命令示例 |
| 1.3 | 2026-04-01 | 命令路由改用 /oc 前缀区分 OpenCode 命令 |
| 1.2 | 2026-04-01 | 补充 /commands 命令和命令路由实现代码 |
| 1.1 | 2026-04-01 | 补充项目浏览与创建命令 (/ls, /new, /mkdir, /tree) |
| 1.0 | 2026-04-01 | 初始版本 |
