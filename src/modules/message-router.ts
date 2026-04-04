import type { Config } from '../types.js';
import type { SessionManager } from './session.js';
import type { NapCatService } from '../services/napcat.js';
import { OpenCodeClient } from '../services/opencode.js';
import { error } from '../utils/logger.js';

export async function handleFreeText(
  qq: string,
  text: string,
  sessions: SessionManager,
  napcat: NapCatService,
  config: Config,
): Promise<boolean> {
  const session = sessions.getOrCreate(qq);
  if (session.state === 'running' && session.sessionId && session.projectPort) {
    try {
      const client = new OpenCodeClient(session.projectPort, config.opencode.password);
      await client.sendMessage(session.sessionId, text);
    } catch (e) {
      error('Free text forward failed', e);
    }
    return true;
  }
  await napcat.sendPrivateMsg(qq, [{ type: 'text', data: { text: '未知命令，请输入 /help 查看帮助' } }]);
  return false;
}
