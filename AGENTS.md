# AGENTS.md

QQ-OpenCode Bridge 代理执行指南。

## 项目概览

- **名称**: `qq-opencode-bridge`
- **栈**: TypeScript (ESM) + Node.js + Vitest + minimatch
- **入口**: `src/index.ts`

### 目录与关键模块

| 路径 | 职责 |
|------|------|
| `src/modules/handlers.ts` | 命令处理器：`handleRun` / `handlePermission` / `handleAbort` |
| `src/modules/event-processor.ts` | SSE 事件状态机：`streaming` → `waiting_permission` → `done` |
| `src/modules/permission-rules.ts` | 权限 glob 匹配（minimatch，first-match-wins） |
| `src/modules/message-router.ts` | 免费文本转发（仅 `running` 状态转发到 OpenCode） |
| `src/modules/session.ts` | 会话状态（`setPendingPermission` / `clearPendingPermission`） |
| `src/services/opencode.ts` | OpenCode HTTP/SSE 客户端（`respondToPermission` API） |
| `src/services/napcat.ts` | NapCat QQ WebSocket 适配 |
| `src/modules/command.ts` | 命令解析与路由（`parseCommand`） |
| `src/modules/process.ts` | OpenCode 进程生命周期管理 |
| `src/utils/logger.ts` | 统一日志（`debug`/`info`/`warn`/`error`） |

## 命令速查

| 用途 | 命令 |
|------|------|
| 安装 | `npm install` |
| 类型检查 | `npm run typecheck` |
| 全量测试 | `npm test` |
| 单文件测试 | `npx vitest run tests/command.test.ts` |
| 单用例测试 | `npx vitest run tests/command.test.ts -t "test name"` |
| 开发 | `npm run dev` |
| 启动 | `npm run start` 或 `bash start-qq.sh start` |
| 重启 | `bash start-qq.sh restart` |

**质量门槛**: `npm run typecheck` + `npm test` 必须通过。无 lint 配置。

## 硬约束（NEVER）

- **NEVER** `@ts-ignore` / `@ts-expect-error` / `as any`
- **NEVER** 空 `catch` 块（除非注释说明可忽略）
- **NEVER** 删测试来"制造通过"
- **NEVER** 先改实现再补测试
- **NEVER** 在 `handleRun` 外直接设 `SessionManager.state` → 用 `setPendingPermission` / `clearPendingPermission`
- **NEVER** 改命令协议文案而不更新对应测试
- **NEVER** 输出敏感信息（token/password）到日志

## 代码风格

```typescript
// ESM + .js 后缀 + import type
import { existsSync } from 'fs';
import { minimatch } from 'minimatch';
import type { Config } from '../types.js';

// guard clause 优先
if (!sessionId) return reply('请先绑定项目');
```

- 2 空格缩进，保留分号，单引号
- 类名 PascalCase，函数/变量 camelCase，常量 UPPER_SNAKE_CASE
- `tsconfig` strict，外部输入使用前校验
- 用户可见错误用中文，API 异常保留 method/path/status

## 架构：权限交互流程

```
handleRun → EventProcessor.handleEvent(SSE)
  ├─ message.part.updated → 累积文本
  ├─ permission.updated → PermissionRules.evaluate()
  │   ├─ 匹配规则 → 自动 respondToPermission API
  │   └─ 无匹配 → setPendingPermission + 通知 QQ 用户
  ├─ session.idle / session.status(idle) → onComplete
  └─ session.error → onError

用户 /approve 或 /reject → handlePermission → processor.respondToPermission → 恢复 running
handleAbort 接受 running + permission_pending 两种状态
```

会话状态机：`idle → running ↔ permission_pending → idle`（`aborting` 为瞬态）

免费文本转发：`handleFreeText` 仅 `running` 时转发到 OpenCode，其他回复"未知命令"。

## 测试规则

- 测试在 `tests/*.test.ts`，修改 `src/modules/*.ts` 必须补对应测试
- bugfix 流程：先写失败测试 → 最小修复 → 验证
- Handler 集成测试用 `createServer` mock HTTP API + SSE 流（参考 `tests/handlers.test.ts`）
- 权限测试覆盖：auto-approve、手动 approve/reject、无 pending 拒绝、abort 中断 permission_pending

## 配置

默认 `config.json`，路径受 `workspaceRoot` 约束。

权限自动授权（可选）：
```json
"permissions": {
  "autoApprovePatterns": [
    { "pattern": "read:*", "response": "always" },
    { "pattern": "bash:Run command: git *", "response": "once" }
  ],
  "defaultAction": "ask"
}
```
- `autoApprovePatterns`：glob（minimatch），匹配 `type:title` 或 `permission.pattern`，first-match-wins
- `defaultAction`：`ask`（转发用户）/ `allow`（自动授权）/ `reject`（自动拒绝）

## 交付前

- [ ] 读过相关代码和测试
- [ ] 测试表达目标行为
- [ ] `npm run typecheck` 通过
- [ ] `npm test` 通过
- [ ] 汇报含：改动点、验证命令、验证结果
