// src/types.ts

// ── Configuration ──────────────────────────────────────────────

export interface Config {
  whitelist: string[];
  workspaceRoot: string;
  napcat: {
    wsUrl: string;
    httpUrl: string;
    token?: string;
    botQQ: string;
  };
  opencode: {
    binaryPath: string;
    portRange: [number, number];
    password?: string;
    commandTimeout: number;
  };
  concurrency: ConcurrencyRule;
  log: {
    level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
    file?: string;
  };
  permissions?: {
    autoApprovePatterns: PermissionRule[];
    defaultAction: 'ask' | 'allow' | 'reject';
  };
}

export interface ConcurrencyRule {
  allowMultiQQPerProject: boolean;
  rejectWhenBusy: boolean;
  abortOwnOnly: boolean;
}

// ── Permission Rules ──────────────────────────────────────────

export interface PermissionData {
  id: string;
  messageID: string;
  sessionID: string;
  title: string;
  type: string;
  metadata: Record<string, unknown>;
  callID?: string;
  pattern?: string | string[];
}

export interface PermissionRule {
  pattern: string;
  response: 'once' | 'always' | 'reject';
}

// ── Runtime State ──────────────────────────────────────────────

export type SessionState =
  | 'idle'
  | 'running'
  | 'permission_pending'
  | 'aborting'
  | 'restarting'
  | 'stopped';

export interface QQSession {
  qq: string;
  projectPath: string | null;
  projectPort: number | null;
  sessionId: string | null;
  model: string | null;
  state: SessionState;
  runningMessageId: string | null;
  pendingPermissionId: string | null;
  createdAt: Date;
  lastActiveAt: Date;
}

export interface ProjectInstance {
  path: string;
  port: number;
  pid: number;
  startedAt: Date;
  sessions: Set<string>;
  status: 'running' | 'stopping' | 'stopped';
}

// ── NapCat Events ──────────────────────────────────────────────

export interface NapCatMessageSegment {
  type: string;
  data: Record<string, unknown>;
}

export interface NapCatMessageEvent {
  post_type: 'message';
  message_type: 'private' | 'group';
  user_id: number;
  group_id?: number;
  message: NapCatMessageSegment[];
  raw_message: string;
}

// ── Parsed Command ─────────────────────────────────────────────

export type CommandType = 'bridge' | 'opencode';

export interface ParsedCommand {
  type: CommandType;
  command: string;
  args: string;
}

// ── Errors ─────────────────────────────────────────────────────

export type ErrorCode =
  | 'ERR_NO_BIND'
  | 'ERR_PATH_NOT_FOUND'
  | 'ERR_PATH_FORBIDDEN'
  | 'ERR_ALREADY_RUNNING'
  | 'ERR_TIMEOUT'
  | 'ERR_START_FAILED'
  | 'ERR_MODEL_NOT_FOUND'
  | 'ERR_UNKNOWN_CMD'
  | 'ERR_NOT_WHITELIST'
  | 'ERR_DIR_EXISTS'
  | 'ERR_GIT_CLONE_FAILED'
  | 'ERR_INVALID_PATH'
  | 'ERR_PERMISSION_PENDING';

export class BridgeError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}
