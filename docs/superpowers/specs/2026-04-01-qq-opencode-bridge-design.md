# QQ-OpenCode Bridge 技术设计文档

**版本**: 1.0  
**日期**: 2026-04-01  
**状态**: 设计完成

---

## 1. 概述

本项目实现了一个 QQ 机器人到 OpenCode 的桥接服务，使用户能够通过 QQ 消息远程控制 OpenCode 进行代码操作。

### 1.1 核心功能

- 通过 QQ 消息打开和管理多个 OpenCode 项目
- 支持所有 OpenCode 命令（`/init`, `/init-deep`, `/mcp`, `/ralph-loop` 等）
- 模型切换（`/modes`）
- 交互式命令支持（可中断）
- 多会话管理（一个 QQ 号绑定一个项目）

### 1.2 技术栈

| 组件 | 技术 | 说明 |
|------|------|------|
| QQ 协议端 | NapCatQQ | OneBot v11/v12 实现 |
| 桥接服务 | TypeScript + Node.js | 主要业务逻辑 |
| OpenCode 通信 | HTTP REST API + SSE | OpenCode 服务器 API |
| 消息协议 | WebSocket (反向) | NapCat → Bridge |

---

## 2. 系统架构

```
┌──────────────────────────────────────────────────────────────────┐
│                         QQ 客户端                                │
│                                                                  │
│  用户发送: /bind /workspace/project1                              │
│           /run 帮我看看代码                                        │
│           /modes claude-3-5-sonnet                              │
│           /init-deep                                            │
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
│  - napcat-reverse-ws: ws://localhost:3001                       │
│  - access-token: (可选)                                         │
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
│  └────────────────┘  └────────────────┘  │ - /init-deep   │     │
│                                           │ - /abort        │     │
│  ┌────────────────┐  ┌────────────────┐  │ - /mcp         │     │
│  │ NapCat 客户端   │  │ OpenCode 客户端 │  │ - /* (全部)     │     │
│  │ - 发送消息     │  │ - REST API     │  └────────────────┘     │
│  │ - 获取用户信息  │  │ - SSE 事件     │                        │
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
  projectPath: string | null;    // 绑定的项目路径
  projectPort: number | null;   // OpenCode 端口
  sessionId: string | null;       // OpenCode Session ID
  model: string | null;          // 当前模型 (providerID/modelID)
  isRunning: boolean;            // 是否有命令正在执行
  createdAt: Date;
  lastActiveAt: Date;
}

// 项目实例
interface ProjectInstance {
  path: string;                  // 项目路径
  port: number;                  // OpenCode 服务端口
  pid: number;                   // 进程 PID
  startedAt: Date;               // 启动时间
  sessions: Set<string>;         // 使用该实例的 QQ 号
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

### 4.5 OpenCode 命令 (全部支持)

| 命令 | 说明 | 示例 |
|------|------|------|
| `/init` | 初始化项目 | `/init` |
| `/init-deep` | 深度初始化 | `/init-deep` |
| `/mcp` | MCP 管理 | `/mcp list` |
| `/ralph-loop` | Ralph 循环 | `/ralph-loop` |
| `/handoff` | 交接会话 | `/handoff` |
| `/start-work` | 开始工作 | `/start-work` |
| `/refactor` | 重构 | `/refactor` |
| `/*` | 其他所有命令 | 自动路由到 OpenCode |

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

---

## 5. 消息流转

```
┌─────────────────────────────────────────────────────────────────┐
│                        完整消息流程                               │
└─────────────────────────────────────────────────────────────────┘

1. QQ 用户发送消息
   └─ "你好 /run 帮我看看代码"

2. NapCat 接收消息
   └─ 识别私聊或 @Bot 消息

3. Bridge 接收事件 (WebSocket)
   └─ {
        "post_type": "message",
        "message_type": "private",
        "user_id": 123456,
        "message": [
          { "type": "text", "data": { "text": "你好 /run 帮我看看代码" } }
        ]
      }

4. 白名单验证
   └─ user_id in whitelist?
       ├─ 是: 继续
       └─ 否: 静默忽略

5. 命令解析
   └─ 从消息中提取命令前缀
       ├─ "/bind"
       ├─ "/run"
       ├─ "/modes"
       └─ ...

6. 执行逻辑

   Case /bind /path/to/project:
   ├─ 验证路径存在
   ├─ 验证路径在 workspaceRoot 下
   ├─ 启动 OpenCode 实例 (如需要)
   ├─ 创建 OpenCode Session
   ├─ 更新会话表 (QQ → 项目映射)
   └─ 发送确认消息

   Case /run <msg>:
   ├─ 检查绑定状态 → 未绑定则拒绝
   ├─ 检查 isRunning → 正在执行则拒绝
   ├─ 设置 isRunning = true
   ├─ 调用 POST /session/:id/message
   ├─ 订阅 SSE 事件流
   ├─ 流式转发到 QQ (分消息发送)
   ├─ 执行完成后设置 isRunning = false
   └─ 发送完成通知

   Case /abort:
   ├─ 找到正在运行的会话
   ├─ 调用 POST /session/:id/abort
   ├─ 设置 isRunning = false
   └─ 发送中断确认

   Case /modes [model]:
   ├─ 无参数: 调用 GET /config/providers
   │   └─ 格式化返回模型列表
   └─ 有参数: 
       ├─ 验证模型存在
       ├─ 更新会话状态
       └─ 发送确认

   Case /* (OpenCode 命令):
   ├─ 解析命令和参数
   ├─ 调用 POST /session/:id/command
   ├─ 订阅 SSE 事件流
   └─ 流式返回结果

7. 结果返回 (通过 NapCat HTTP API)
   └─ POST /send_msg
       body: {
         "user_id": 123456,
         "message": "执行结果..."
       }
```

---

## 6. OpenCode API 使用

### 6.1 启动 OpenCode 实例

```bash
opencode serve --port 3001 --hostname 127.0.0.1 --dir /path/to/project
```

### 6.2 发送消息并流式返回

```typescript
// 1. 创建 Session
const session = await client.session.create({
  body: { title: "QQ Session" }
});

// 2. 发送消息
await client.session.prompt({
  path: { id: session.id },
  body: {
    model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" },
    parts: [{ type: "text", text: "帮我看看这个函数" }]
  }
});

// 3. 订阅事件流
const events = await client.event.subscribe();
for await (const event of events.stream) {
  // event.type: session.message, session.completed, session.error
  // 处理并转发到 QQ
}
```

### 6.3 执行命令

```typescript
await client.session.command({
  path: { id: sessionId },
  body: {
    command: "init-deep",
    arguments: ""
  }
});
```

### 6.4 模型列表

```typescript
const { providers, default: defaults } = await client.config.providers();
// providers: [{ id, name, models: [...] }]
```

### 6.5 中断执行

```typescript
await client.session.abort({
  path: { id: sessionId }
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

### 9.2 命令限制

- 所有命令通过 OpenCode API 执行，不直接执行 shell 命令
- OpenCode 本身的权限控制生效

### 9.3 通信安全

- 建议配置 `access-token`
- NapCat 和 Bridge 之间使用 localhost 通信
- OpenCode 服务绑定到 127.0.0.1

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
    "portRange": [3001, 3999],
    "password": "optional-password",
    "commandTimeout": 300000
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
- [ ] 所有 OpenCode 命令支持
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
| 1.1 | 2026-04-01 | 补充项目浏览与创建命令 (/ls, /new, /mkdir, /tree) |
| 1.0 | 2026-04-01 | 初始版本 |
