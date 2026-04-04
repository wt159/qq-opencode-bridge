import { describe, it, expect, vi } from 'vitest';
import { EventProcessor } from '../src/modules/event-processor.js';
import { PermissionRules } from '../src/modules/permission-rules.js';
import { OpenCodeClient } from '../src/services/opencode.js';
import type { OpenCodeEvent } from '../src/services/opencode.js';
import type { PermissionData } from '../src/types.js';

vi.mock('../src/services/opencode.js', () => {
  return {
    OpenCodeClient: vi.fn().mockImplementation(() => ({
      respondToPermission: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

function makeEvent(type: string, properties: Record<string, unknown> = {}): OpenCodeEvent {
  return { type, properties };
}

function makePermEvent(perm: Partial<PermissionData> = {}): OpenCodeEvent {
  const permission: PermissionData = {
    id: 'perm-1',
    messageID: 'msg-1',
    sessionID: 'ses-1',
    title: 'Run command: rm -rf /',
    type: 'bash',
    metadata: {},
    ...perm,
  };
  return { type: 'permission.updated', properties: { permission, sessionID: 'ses-1' } };
}

describe('EventProcessor', () => {
  function createProcessor(rules?: PermissionRules) {
    const permissionRules = rules ?? new PermissionRules([], 'ask');
    const client = new OpenCodeClient(3000);
    const callbacks = {
      onText: vi.fn(),
      onPermissionRequest: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };
    const processor = new EventProcessor(permissionRules, client, 'ses-1', callbacks);
    return { processor, client, callbacks };
  }

  it('accumulates text from message.part.updated events', async () => {
    const { processor, callbacks } = createProcessor();
    await processor.handleEvent(makeEvent('message.part.updated', {
      part: { type: 'text', text: 'Hello ' },
    }));
    await processor.handleEvent(makeEvent('message.part.updated', {
      part: { type: 'text', text: 'World' },
    }));
    expect(callbacks.onText).toHaveBeenCalledWith('Hello ');
    expect(callbacks.onText).toHaveBeenCalledWith('World');
    expect(processor.currentText).toBe('Hello World');
  });

  it('ignores non-text part types in message.part.updated', async () => {
    const { processor, callbacks } = createProcessor();
    await processor.handleEvent(makeEvent('message.part.updated', {
      part: { type: 'tool-use', text: 'ignored' },
    }));
    expect(callbacks.onText).not.toHaveBeenCalled();
    expect(processor.currentText).toBe('');
  });

  it('fires onComplete on session.idle event', async () => {
    const { processor, callbacks } = createProcessor();
    await processor.handleEvent(makeEvent('message.part.updated', {
      part: { type: 'text', text: 'result' },
    }));
    await processor.handleEvent(makeEvent('session.idle', { sessionID: 'ses-1' }));
    expect(callbacks.onComplete).toHaveBeenCalledWith('result');
    expect(processor.currentState).toBe('done');
  });

  it('fires onComplete on session.status idle event (backward compat)', async () => {
    const { processor, callbacks } = createProcessor();
    await processor.handleEvent(makeEvent('message.part.updated', {
      part: { type: 'text', text: 'ok' },
    }));
    await processor.handleEvent(makeEvent('session.status', {
      sessionID: 'ses-1',
      status: { type: 'idle' },
    }));
    expect(callbacks.onComplete).toHaveBeenCalledWith('ok');
    expect(processor.currentState).toBe('done');
  });

  it('fires onError on session.error event', async () => {
    const { processor, callbacks } = createProcessor();
    await processor.handleEvent(makeEvent('session.error', {
      sessionID: 'ses-1',
      error: { data: { message: 'something broke' } },
    }));
    expect(callbacks.onError).toHaveBeenCalledWith('something broke');
    expect(processor.currentState).toBe('done');
  });

  it('fires onError with default message when no error message present', async () => {
    const { processor, callbacks } = createProcessor();
    await processor.handleEvent(makeEvent('session.error', {
      sessionID: 'ses-1',
    }));
    expect(callbacks.onError).toHaveBeenCalledWith('OpenCode 执行失败');
  });

  it('auto-approves permission when rules match', async () => {
    const rules = new PermissionRules(
      [{ pattern: 'bash:Run command: git *', response: 'once' }],
      'ask',
    );
    const { processor, client, callbacks } = createProcessor(rules);
    const event = makePermEvent({ title: 'Run command: git status' });
    await processor.handleEvent(event);
    expect(client.respondToPermission).toHaveBeenCalledWith('ses-1', 'perm-1', 'once');
    expect(callbacks.onPermissionRequest).not.toHaveBeenCalled();
    expect(processor.currentState).toBe('streaming');
  });

  it('notifies user when no rule matches permission', async () => {
    const { processor, callbacks } = createProcessor();
    const event = makePermEvent();
    await processor.handleEvent(event);
    expect(callbacks.onPermissionRequest).toHaveBeenCalled();
    const perm = callbacks.onPermissionRequest.mock.calls[0][0] as PermissionData;
    expect(perm.id).toBe('perm-1');
    expect(perm.title).toBe('Run command: rm -rf /');
    expect(processor.currentState).toBe('waiting_permission');
  });

  it('handles auto-approve API failure gracefully', async () => {
    const rules = new PermissionRules(
      [{ pattern: 'bash:*', response: 'once' }],
      'ask',
    );
    const { processor, client, callbacks } = createProcessor(rules);
    (client.respondToPermission as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('API error'),
    );
    const event = makePermEvent();
    await processor.handleEvent(event);
    expect(callbacks.onPermissionRequest).toHaveBeenCalled();
    expect(processor.currentState).toBe('waiting_permission');
  });

  it('respondToPermission calls API and resumes streaming', async () => {
    const { processor, client, callbacks } = createProcessor();
    const event = makePermEvent();
    await processor.handleEvent(event);
    expect(processor.currentState).toBe('waiting_permission');

    await processor.respondToPermission('perm-1', 'once');
    expect(client.respondToPermission).toHaveBeenCalledWith('ses-1', 'perm-1', 'once');
    expect(processor.currentState).toBe('streaming');
  });

  it('ignores unknown event types', async () => {
    const { processor, callbacks } = createProcessor();
    await processor.handleEvent(makeEvent('unknown.event', { foo: 'bar' }));
    expect(callbacks.onText).not.toHaveBeenCalled();
    expect(callbacks.onPermissionRequest).not.toHaveBeenCalled();
    expect(callbacks.onComplete).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(processor.currentState).toBe('streaming');
  });
});
