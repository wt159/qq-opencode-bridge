import type { QQSession, SessionState } from '../types.js';

export class SessionManager {
  private sessions = new Map<string, QQSession>();

  getOrCreate(qq: string): QQSession {
    if (!this.sessions.has(qq)) {
      this.sessions.set(qq, {
        qq,
        projectPath: null,
        projectPort: null,
        sessionId: null,
        model: null,
        state: 'idle',
        runningMessageId: null,
        pendingPermissionId: null,
        createdAt: new Date(),
        lastActiveAt: new Date(),
      });
    }
    return this.sessions.get(qq)!;
  }

  bindProject(qq: string, projectPath: string, port: number, sessionId: string): void {
    const s = this.getOrCreate(qq);
    s.projectPath = projectPath;
    s.projectPort = port;
    s.sessionId = sessionId;
    s.state = 'idle';
    s.lastActiveAt = new Date();
  }

  unbind(qq: string): void {
    const s = this.sessions.get(qq);
    if (s) {
      s.projectPath = null;
      s.projectPort = null;
      s.sessionId = null;
      s.model = null;
      s.state = 'idle';
      s.pendingPermissionId = null;
      s.runningMessageId = null;
    }
  }

  setModel(qq: string, model: string): void {
    const s = this.getOrCreate(qq);
    s.model = model;
  }

  setState(qq: string, state: SessionState): void {
    const s = this.getOrCreate(qq);
    s.state = state;
  }

  getAll(): QQSession[] {
    return Array.from(this.sessions.values());
  }

  delete(qq: string): void {
    this.sessions.delete(qq);
  }
}
