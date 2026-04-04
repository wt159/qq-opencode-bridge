import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from '../src/modules/session.js';

describe('SessionManager', () => {
  let mgr: SessionManager;
  beforeEach(() => { mgr = new SessionManager(); });

  it('creates a new session', () => {
    const s = mgr.getOrCreate('123');
    expect(s.qq).toBe('123');
    expect(s.state).toBe('idle');
  });

  it('returns same session for same QQ', () => {
    const s1 = mgr.getOrCreate('123');
    const s2 = mgr.getOrCreate('123');
    expect(s1).toBe(s2);
  });

  it('binds a project to a session', () => {
    const s = mgr.getOrCreate('123');
    mgr.bindProject('123', '/workspace/proj', 3002, 'session-abc');
    expect(s.projectPath).toBe('/workspace/proj');
    expect(s.projectPort).toBe(3002);
    expect(s.sessionId).toBe('session-abc');
  });

  it('unbinds a session', () => {
    mgr.getOrCreate('123');
    mgr.bindProject('123', '/workspace/proj', 3002, 'abc');
    mgr.unbind('123');
    const s = mgr.getOrCreate('123');
    expect(s.projectPath).toBeNull();
  });

    it('updates model', () => {
      const s = mgr.getOrCreate('123');
      mgr.setModel('123', 'anthropic/claude-3-5-sonnet');
      expect(s.model).toBe('anthropic/claude-3-5-sonnet');
    });

    it('sets pending permission', () => {
      mgr.bindProject('123', '/workspace/proj', 3002, 'ses-abc');
      mgr.setPendingPermission('123', 'perm-1');
      const s = mgr.getOrCreate('123');
      expect(s.state).toBe('permission_pending');
      expect(s.pendingPermissionId).toBe('perm-1');
    });

    it('clears pending permission and resumes running', () => {
      mgr.bindProject('123', '/workspace/proj', 3002, 'ses-abc');
      mgr.setPendingPermission('123', 'perm-1');
      mgr.clearPendingPermission('123', 'running');
      const s = mgr.getOrCreate('123');
      expect(s.state).toBe('running');
      expect(s.pendingPermissionId).toBeNull();
    });

    it('clears pending permission and resumes idle', () => {
      mgr.bindProject('123', '/workspace/proj', 3002, 'ses-abc');
      mgr.setPendingPermission('123', 'perm-1');
      mgr.clearPendingPermission('123', 'idle');
      const s = mgr.getOrCreate('123');
      expect(s.state).toBe('idle');
      expect(s.pendingPermissionId).toBeNull();
    });
});
