# QQ-OpenCode Bridge

🎮 通过 QQ 消息远程控制 [OpenCode](https://opencode.ai) 进行代码操作。

Bridge 桥接 QQ（经由 [NapCatQQ](https://napneko.github.io/)）与 OpenCode Server，让你可以在 QQ 私聊或群聊中直接发送自然语言指令来编写、修改和管理代码。

## 功能

- **自然语言编程** — `/run 帮我重构这个函数`，OpenCode 执行后结果回传 QQ
- **多项目管理** — 同时管理多个项目，随时 `/switch` 切换
- **权限交互** — OpenCode 请求危险操作时转发到 QQ，`/approve` 或 `/reject`
- **模型切换** — `/modes` 查看和切换 AI 模型
- **Slash Commands** — `/oc` 前缀调用 OpenCode 内置命令
- **多用户** — 支持白名单内多个 QQ 号绑定同一项目
- **自动授权规则** — 支持配置 glob 模式匹配，自动 approve/reject 权限请求

## 系统要求

| 依赖 | 版本要求 | 说明 |
|------|----------|------|
| Node.js | >= 20 | 运行时环境 |
| npm | >= 9 | 包管理 |
| OpenCode | latest | `opencode` CLI 已安装且可用 |
| NapCatQQ | latest | QQ OneBot 协议端 |
| jq | any (可选) | 用于启动脚本解析 JSON 配置 |

> OpenCode 需要提前安装。参考 [OpenCode 官方文档](https://opencode.ai)。

## 快速开始

### 1. 克隆并安装

```bash
git clone https://github.com/wt159/qq-opencode-bridge.git
cd qq-opencode-bridge
npm install
```

### 2. 创建配置文件

```bash
cp config.example.json config.json
```

编辑 `config.json`，填入你的配置：

```json
{
  "whitelist": ["你的QQ号"],
  "workspaceRoot": "/home/user/workspace",
  "napcat": {
    "wsUrl": "ws://localhost:3001",
    "httpUrl": "http://localhost:3000",
    "token": "your-napcat-token",
    "botQQ": "机器人QQ号"
  },
  "opencode": {
    "binaryPath": "/home/user/.opencode/bin/opencode",
    "portRange": [3002, 3999],
    "password": "optional-opencode-password",
    "commandTimeout": 300000
  },
  "concurrency": {
    "allowMultiQQPerProject": true,
    "rejectWhenBusy": true,
    "abortOwnOnly": true
  },
  "log": {
    "level": "INFO",
    "file": "./logs/bridge.log"
  }
}
```

**必填配置说明：**

| 字段 | 说明 |
|------|------|
| `whitelist` | 允许使用 Bot 的 QQ 号列表 |
| `workspaceRoot` | 项目根目录，所有项目路径必须在此目录下 |
| `napcat.wsUrl` | Bridge 反向 WebSocket 地址，NapCat 会连接此地址推送消息（如 `ws://localhost:3001`） |
| `napcat.httpUrl` | NapCat HTTP API 地址，Bridge 通过此地址发送 QQ 消息（如 `http://localhost:3000`） |
| `napcat.token` | NapCat 访问令牌，需与 NapCat WebUI 和 onebot11 配置中的 token 一致 |
| `napcat.botQQ` | 机器人 QQ 号 |
| `napcat.notifyQQ` | （可选）NapCat 连接成功后发送通知的 QQ 号 |
| `opencode.binaryPath` | `opencode` 可执行文件路径 |
| `opencode.portRange` | OpenCode 实例端口范围（每个项目分配一个端口） |
| `opencode.commandTimeout` | 命令执行超时时间（毫秒） |

### NapCat 端口配置

NapCat 需要配置 HTTP 服务和反向 WebSocket。打开 NapCat WebUI（默认 `http://localhost:6099`），登录后进行以下配置：

**1. 添加反向 WebSocket：**

在网络配置中添加反向 WebSocket，地址填 Bridge 的 WS 地址：

```
ws://localhost:3001
```

**2. 开启 HTTP 服务：**

确保 HTTP 服务已开启，端口与 `config.json` 中的 `napcat.httpUrl` 一致（默认 3000）。

> 端口规划：Bridge WS 端口 3001 / NapCat HTTP 端口 3000 / OpenCode 实例端口 3002-3999，各端口不可重叠。

### 3. 启动

**一键启动（推荐）：**

```bash
bash start-qq.sh start
```

启动脚本会自动完成：依赖检查 → NapCat WebUI 配置 → 反向 WS 配置 → Bridge 启动 → QQ 启动。

**手动启动：**

```bash
# 启动 Bridge
npm run start
# 或开发模式
npm run dev
```

**其他命令：**

```bash
bash start-qq.sh start     # 启动服务
bash start-qq.sh stop      # 停止服务
bash start-qq.sh restart   # 重启服务
bash start-qq.sh status    # 查看状态
```

### 4. 安装 NapCat（如果还没有）

```bash
bash install-napcat.sh
```

该脚本会自动下载安装 NapCat 并配置反向 WebSocket 连接。

## 使用方式

在 QQ 中向 Bot 发送以下命令：

### 基础操作

| 命令 | 说明 |
|------|------|
| `/bind <path>` | 绑定项目（如 `/bind /home/user/workspace/my-project`） |
| `/unbind <name>` | 解绑并关闭项目 |
| `/switch <name>` | 切换到已运行的项目 |
| `/status` | 查看当前状态 |
| `/list` | 列出运行中的项目 |

### 项目管理

| 命令 | 说明 |
|------|------|
| `/ls` | 列出 workspaceRoot 下所有项目 |
| `/new <name>` | 新建空项目 |
| `/new <url> <name>` | 从 Git 克隆项目 |
| `/tree` | 显示项目目录树 |

### 代码执行

| 命令 | 说明 |
|------|------|
| `/run <指令>` | 执行自然语言指令 |
| `/abort` | 中断正在执行的命令 |
| `/approve` | 授权权限请求 |
| `/reject` | 拒绝权限请求 |

### 模型与命令

| 命令 | 说明 |
|------|------|
| `/modes` | 列出可用模型 |
| `/modes <name>` | 切换模型 |
| `/commands` | 列出 OpenCode 可用命令 |
| `/oc <cmd>` | 执行 OpenCode slash command |

### 进程管理

| 命令 | 说明 |
|------|------|
| `/stop <path>` | 关闭指定项目 |
| `/stopall` | 关闭所有项目 |
| `/help` | 查看帮助 |

> 群聊中使用时需要在命令前 `@Bot`。

## 权限自动授权

可以在 `config.json` 中配置自动授权规则，减少手动确认：

```json
{
  "permissions": {
    "autoApprovePatterns": [
      { "pattern": "read:*", "response": "always" },
      { "pattern": "bash:Run command: git *", "response": "once" }
    ],
    "defaultAction": "ask"
  }
}
```

- **`autoApprovePatterns`** — glob 模式（minimatch），匹配 `type:title` 或 `permission.pattern`，first-match-wins
- **`defaultAction`** — `ask`（转发用户确认）/ `allow`（自动授权）/ `reject`（自动拒绝）

## 项目结构

```
src/
├── index.ts                 # 入口
├── config.ts                # 配置加载与校验
├── types.ts                 # 类型定义
├── modules/
│   ├── command.ts           # 命令解析与路由
│   ├── handlers.ts          # 命令处理器
│   ├── event-processor.ts   # SSE 事件状态机
│   ├── message-router.ts    # 免费文本转发
│   ├── permission-rules.ts  # 权限 glob 匹配
│   ├── session.ts           # 会话状态管理
│   ├── process.ts           # OpenCode 进程管理
│   ├── filesystem.ts        # 文件系统操作
│   └── whitelist.ts         # 白名单验证
├── services/
│   ├── napcat.ts            # NapCat WebSocket 适配
│   └── opencode.ts          # OpenCode HTTP/SSE 客户端
└── utils/
    └── logger.ts            # 日志工具
```

## 开发

```bash
# 开发模式（文件变动自动重启）
npm run dev

# 类型检查
npm run typecheck

# 运行全部测试
npm test

# 运行单个测试文件
npx vitest run tests/command.test.ts

# 运行单个测试用例
npx vitest run tests/command.test.ts -t "test name"
```

## 架构

```
QQ 用户 ←→ NapCat ←(WebSocket)→ Bridge ←(HTTP/SSE)→ OpenCode Server
```

Bridge 作为 WebSocket 服务端接收 NapCat 推送的消息事件，解析命令后通过 HTTP API 与 OpenCode Server 通信，执行结果通过 NapCat HTTP API 回传 QQ。

## License

MIT
