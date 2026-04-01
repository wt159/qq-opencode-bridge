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

  async getProviders(): Promise<{ providers: { id: string; name: string; models: { id: string }[] }[]; default: Record<string, string> }> {
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
}
