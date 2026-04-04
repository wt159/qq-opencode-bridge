import type { PermissionData } from '../types.js';
import type { OpenCodeClient } from '../services/opencode.js';
import type { OpenCodeEvent } from '../services/opencode.js';
import type { PermissionRules } from './permission-rules.js';
import { debug, info } from '../utils/logger.js';

export type EventProcessorState = 'streaming' | 'waiting_permission' | 'done';

export type EventProcessorCallbacks = {
  onText: (text: string) => void;
  onPermissionRequest: (perm: PermissionData) => void;
  onComplete: (text: string) => void;
  onError: (error: string) => void;
};

export class EventProcessor {
  private text = '';
  private state: EventProcessorState = 'streaming';

  constructor(
    private rules: PermissionRules,
    private client: OpenCodeClient,
    private sessionId: string,
    private callbacks: EventProcessorCallbacks,
  ) {}

  async handleEvent(event: OpenCodeEvent): Promise<void> {
    switch (event.type) {
      case 'message.part.updated': {
        const props = event.properties as {
          part?: { type?: string; text?: string };
        } | undefined;
        const part = props?.part;
        if (part?.type === 'text' && part.text) {
          this.text += part.text;
          this.callbacks.onText(part.text);
        }
        break;
      }

      case 'permission.updated': {
        const props = event.properties as {
          permission?: PermissionData;
        } | undefined;
        const perm = props?.permission;
        if (!perm) break;
        debug('Permission request received', {
          sessionId: this.sessionId,
          permissionId: perm.id,
          permissionType: perm.type,
        });

        const decision = this.rules.evaluate(perm);
        if (decision) {
          try {
            await this.client.respondToPermission(this.sessionId, perm.id, decision);
          } catch (e) {
            info('Auto-approve failed, degrading to manual confirmation', e);
            this.state = 'waiting_permission';
            this.callbacks.onPermissionRequest(perm);
          }
        } else {
          this.state = 'waiting_permission';
          this.callbacks.onPermissionRequest(perm);
        }
        break;
      }

      case 'session.idle':
      case 'session.status': {
        // Handle both session.idle (newer OpenCode) and session.status with idle subtype (older)
        if (event.type === 'session.status') {
          const props = event.properties as {
            status?: { type?: string };
          } | undefined;
          if (props?.status?.type !== 'idle') break;
        }
        this.state = 'done';
        this.callbacks.onComplete(this.text);
        break;
      }

      case 'session.error': {
        const props = event.properties as {
          error?: { data?: { message?: string } };
        } | undefined;
        const msg = props?.error?.data?.message || 'OpenCode 执行失败';
        this.state = 'done';
        this.callbacks.onError(msg);
        break;
      }

      default:
        break;
    }
  }

  async respondToPermission(permissionId: string, response: 'once' | 'always' | 'reject'): Promise<void> {
    await this.client.respondToPermission(this.sessionId, permissionId, response);
    this.state = 'streaming';
  }

  get currentState(): EventProcessorState {
    return this.state;
  }

  get currentText(): string {
    return this.text;
  }
}
