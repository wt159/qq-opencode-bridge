import type { PermissionData } from '../types.js';

export type OpenCodeEvent = {
  type: string;
  properties?: {
    sessionID?: string;
    status?: { type: string };
    part?: { type: string; text?: string };
    error?: { name?: string; data?: { message?: string } };
    permission?: PermissionData;
  };
};

export class OpenCodeClient {
  private baseUrl: string;
  private password?: string;

  constructor(port: number, password?: string) {
    this.baseUrl = `http://127.0.0.1:${port}`;
    this.password = password;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.password) {
      headers['Authorization'] = `Basic ${Buffer.from(`opencode:${this.password}`).toString('base64')}`;
    }
    return headers;
  }

  private async request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const opts: RequestInit = {
      method,
      headers: this.getHeaders(),
      signal,
    };
    if (body) {
      opts.body = JSON.stringify(body);
    }
    const resp = await fetch(url, opts);
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`OpenCode API error: ${resp.status} ${resp.statusText} for ${method} ${path}. Body: ${text}`);
    }
    if (resp.status === 204) return undefined as T;
    const text = await resp.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch (e) {
      throw new Error(`Failed to parse JSON response: ${text}. Error: ${e}`);
    }
  }

  async createSession(title?: string): Promise<{ id: string }> {
    return this.request('/session', 'POST', { title });
  }

  async sendMessage(
    sessionId: string,
    text: string,
    model?: { providerID: string; modelID: string },
    signal?: AbortSignal,
  ): Promise<{ parts: { type: string; text?: string }[] }> {
    const body: Record<string, unknown> = {
      parts: [{ type: 'text', text }],
    };
    if (model) body.model = model;
    return this.request(`/session/${sessionId}/message`, 'POST', body, signal);
  }

  async sendCommand(sessionId: string, command: string, args: string): Promise<{ parts: { type: string; text?: string }[] }> {
    return this.request(`/session/${sessionId}/command`, 'POST', { command, arguments: args });
  }

  async abort(sessionId: string): Promise<void> {
    return this.request(`/session/${sessionId}/abort`, 'POST');
  }

  async respondToPermission(sessionId: string, permissionId: string, response: 'once' | 'always' | 'reject', remember = false): Promise<void> {
    return this.request(`/session/${sessionId}/permissions/${permissionId}`, 'POST', { response, remember });
  }

  async listSessions(): Promise<{ id: string; directory: string }[]> {
    return this.request('/session');
  }

  async getProviders(): Promise<{ providers: { id: string; name: string; models: Record<string, { id: string; name: string }> | { id: string; name: string }[] }[]; default: Record<string, string> }> {
    return this.request('/config/providers');
  }

  async listCommands(): Promise<{ name: string; description?: string }[]> {
    return this.request('/command');
  }

  async isHealthy(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.baseUrl}/global/health`);
      return resp.ok;
    } catch {
      return false;
    }
  }

  subscribeEvents(sessionId: string): AsyncIterableIterator<OpenCodeEvent> & { controller: AbortController } {
    const controller = new AbortController();
    const url = `${this.baseUrl}/event`;

    const headers = this.getHeaders();

    async function* eventStream() {
      const resp = await fetch(url, { headers, signal: controller.signal });
      const reader = resp.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;

            const dataStr = trimmed.slice(6).trim();
            if (!dataStr) continue;

            try {
              const data = JSON.parse(dataStr) as OpenCodeEvent;
              if (!data.properties?.sessionID || data.properties.sessionID === sessionId) {
                yield data;
              }
            } catch {
              continue;
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    }

    const iter = eventStream();
    return Object.assign(iter, { controller });
  }
}
