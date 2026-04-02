# AGENTS.md（中文）
本文件给在本仓库执行任务的代理使用（Codex/Claude/GPT Agents）。
目标：快速交付、可验证、与现有风格一致。

## 1) 项目与目录
- 项目：`qq-opencode-bridge`
- 技术栈：TypeScript（ESM）+ Node.js + Vitest
- 入口：`src/index.ts`
- 目录约定：
  - `src/modules/*`：业务逻辑
  - `src/services/*`：NapCat/OpenCode 适配
  - `src/utils/*`：工具函数
  - `tests/*`：单元测试

## 2) 构建/运行/测试命令
先安装依赖：
```bash
npm install
```
开发模式（watch）：
```bash
npm run dev
```
普通启动：
```bash
npm run start
```
全量测试：
```bash
npm test
# 等价：npx vitest run
```
单文件测试（重点）：
```bash
npx vitest run tests/command.test.ts
# 或：npm test -- tests/command.test.ts
```
单个测试用例：
```bash
npx vitest run tests/command.test.ts -t "parses OpenCode command"
```
测试监听：
```bash
npm run test:watch
```
类型检查：
```bash
npm run typecheck
```

## 3) Lint / Format 现状
- 当前 `package.json` 未提供 `lint` 脚本。
- 当前仓库未发现 ESLint/Prettier 配置文件。
- 默认质量门槛：`npm run typecheck` + `npm test` 必须通过。

## 4) 代理执行流程（必须）
1. 先读相关模块和现有测试，确认行为边界。
2. 先改测试表达目标（尤其 bugfix 先写失败测试）。
3. 用最小改动修实现，不做无关重构。
4. 至少执行：
   - `npm run typecheck`
   - `npm test`（可先单测后全量）
5. 汇报必须包含：改动点、验证命令、验证结果。

## 5) 代码风格规范
### 5.1 Imports
- 使用 ESM `import`。
- 本地路径显式 `.js` 后缀（TS 文件内也保持一致）。
  - 例如：`import { loadConfig } from './config.js';`
- 类型导入优先 `import type`。
- 导入顺序建议：Node 内置 → 第三方 → 本地模块。

### 5.2 Formatting
- 2 空格缩进。
- 保留分号。
- 字符串以单引号为主。
- 长参数列表可多行并保留尾逗号。
- 优先使用 guard clause（早返回）减少嵌套。

### 5.3 Types
- `tsconfig` 启用 `strict: true`，必须保持类型安全。
- 禁止 `@ts-ignore` / `@ts-expect-error` 掩盖问题。
- 避免 `any`；如不可避免需最小范围且写明理由。
- 外部输入（配置、HTTP 响应）使用前做必要校验。

### 5.4 Naming
- 类名：PascalCase（如 `ProcessManager`）。
- 函数/变量：camelCase（如 `parseCommand`）。
- 常量：UPPER_SNAKE_CASE（如 `BRIDGE_COMMANDS`）。
- 测试用例名称保持行为描述风格（`it('...')`）。

### 5.5 Error Handling
- 用户可见错误返回可读中文提示。
- 系统错误必须记录日志，不可静默吞错。
- `catch` 仅在“明确可忽略”场景允许忽略异常。
- 外部 API 异常要保留 method/path/status 等上下文。

### 5.6 Logging
- 统一使用 `src/utils/logger.ts`（`debug/info/warn/error`）。
- 日志需包含定位上下文（模块、端口、路径、会话）。
- 严禁输出敏感信息（token/password）。

## 6) 业务约束与状态管理
- 会话状态基于 `QQSession.state`。
- 修改执行链路时，确保成功/失败都能正确回收状态。
- 涉及 SSE/超时/中断时，必须释放资源（如 AbortController）。
- 不要擅自改变命令协议（尤其 `/oc` 与桥接命令边界）。
- `/unbind <path>` 和 `/switch <path>` 是**项目级**命令：不要把它们实现成“解绑 QQ 账号”的全局操作。
- 涉及项目切换/解绑时，同时检查 `SessionManager` 与 `ProcessManager` 的状态一致性，避免出现“已切换但实例未更新”或“已解绑但进程仍在运行”的情况。

## 7) 测试约定
- 测试位于 `tests/*.test.ts`。
- 修改 `src/modules/*.ts` 时优先补对应测试。
- bugfix 必须先加失败测试再修复实现。
- 不允许通过删除/弱化测试来“制造通过”。
- 新增或变更命令语义时，必须补 `tests/command.test.ts`（解析/路由）和至少一个 `handlers` 级测试（真实状态变更）。

## 8) 配置约定
- 默认配置：`config.json`。
- 路径操作受 `workspaceRoot` 限制。
- 白名单能力依赖 `whitelist` 与 `botQQ`。
- OpenCode 端口由 `opencode.portRange` 管理。

## 9) Cursor / Copilot 规则检查结果
已检查以下路径：
- `.cursor/rules/`
- `.cursorrules`
- `.github/copilot-instructions.md`
结论：当前仓库未发现上述规则文件。
如后续新增规则，请同步更新本文件。

## 10) 交付前 Checklist
- [ ] 已阅读相关代码与测试
- [ ] 已通过测试表达目标行为
- [ ] 已完成最小必要实现改动
- [ ] `npm run typecheck` 通过
- [ ] `npm test` 通过（或先单测后全量）
- [ ] 汇报中包含验证命令与结果

## 11) 常见误区（避免）
- 不要先改代码再补测试。
- 不要在未知行为下直接重构多个模块。
- 不要把调试日志长期留在生产路径。
- 不要修改命令协议文案却不更新测试。
- 不要将运行时异常静默吞掉。
- 不要引入 `@ts-ignore` 作为“临时修复”。
- 不要更改白名单/权限判断逻辑而无测试覆盖。
