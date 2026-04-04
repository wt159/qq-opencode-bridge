import { WebSocketServer, WebSocket } from 'ws';
import type { Config, NapCatMessageEvent } from '../types.js';
import { info, error, debug } from '../utils/logger.js';

export type MessageHandler = (event: NapCatMessageEvent) => Promise<void>;

export class NapCatService {
  private wss: WebSocketServer | null = null;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  start(handler: MessageHandler, onConnect?: () => Promise<void>): Promise<void> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port: this.parsePort() }, () => {
        info(`NapCat WS server listening on port ${this.parsePort()}`);
        resolve();
      });

      this.wss.on('connection', async (ws, req) => {
        info(`NapCat connected from ${req.socket.remoteAddress}`);
        if (onConnect) {
          info('onConnect callback fired, invoking...');
          try {
            await onConnect();
            info('onConnect callback completed successfully');
          } catch (e) {
            error('onConnect callback failed', e);
          }
        }

        ws.on('message', async (data) => {
          try {
            const event = JSON.parse(data.toString()) as NapCatMessageEvent;
            if (event.post_type === 'message') {
              await handler(event);
            }
          } catch (e) {
            error('Failed to parse NapCat message', e);
          }
        });

        ws.on('error', (e) => error('NapCat WS error', e));
      });
    });
  }

  private parsePort(): number {
    const url = new URL(this.config.napcat.wsUrl);
    return parseInt(url.port, 10);
  }

  async sendPrivateMsg(qq: string, message: string | unknown[]): Promise<void> {
    await this.sendNapCatApi('send_private_msg', { user_id: parseInt(qq, 10), message });
  }

  async sendGroupMsg(groupId: number, message: string | unknown[]): Promise<void> {
    await this.sendNapCatApi('send_group_msg', { group_id: groupId, message });
  }

  private async sendNapCatApi(action: string, params: Record<string, unknown>): Promise<void> {
    const url = `${this.config.napcat.httpUrl}/${action}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.napcat.token) {
      headers['Authorization'] = `Bearer ${this.config.napcat.token}`;
    }

    info(`NapCat API call: ${action}`, JSON.stringify(params));

    let resp: Response;
    try {
      resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(params) });
    } catch (e) {
      error(`NapCat API network error: ${action} ${url}`, e);
      throw e;
    }

    const body = await resp.text();
    if (!resp.ok) {
      error(`NapCat API error: ${resp.status} ${resp.statusText}`, body);
      throw new Error(`NapCat API error: ${resp.status} ${resp.statusText} - ${body}`);
    }
    info(`NapCat API response: ${action} ${resp.status}`, body);
  }

  stop(): void {
    this.wss?.close();
  }
}
