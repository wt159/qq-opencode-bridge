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

  private async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const opts: RequestInit = {
      method,
      headers: this.getHeaders(),
    };
    if (body) {
      opts.body = JSON.stringify(body);
    }
    const resp = await fetch(url, opts);
    if (!resp.ok) {
      throw new Error(`OpenCode API error: ${resp.status} ${resp.statusText} for ${method} ${path}`);
    }
    if (resp.status === 204) return undefined as T;
    return resp.json() as Promise<T>;
  }

  async createSession(title?: string): Promise<{ id: string }> {
    return this.request('/session', 'POST', { title });
  }

  async sendMessage(sessionId: string, text: string, model?: { providerID: string; modelID: string }): Promise<{ parts: { type: string; text?: string }[] }> {
    const body: Record<string, unknown> = {
      parts: [{ type: 'text', text }],
    };
    if (model) body.model = model;
    return this.request(`/session/${sessionId}/message`, 'POST', body);
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

  async getProviders(): Promise<{ providers: { id: string; name: string; models: Record<string, { id: string; name: string }> | { id: string; name: string }[] }; default: Record<string, string> }> {
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

  subscribeEvents(sessionId: string): AsyncIterableIterator<{ type: string; data?: unknown }> & { controller: AbortController } {
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
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              const eventType = line.slice(7).trim();
              // Read next line for data
              const dataLine = lines.shift();
              if (dataLine?.startsWith('data: ')) {
                try {
                  const data = JSON.parse(dataLine.slice(6));
                  if (data.sessionId === sessionId || !data.sessionId) {
                    yield { type: eventType, data };
                  }
                } catch { /* skip invalid JSON */ }
              }
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
