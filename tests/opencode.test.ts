import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenCodeClient } from '../src/services/opencode.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('OpenCodeClient respondToPermission', () => {
  it('does not fall back to V1 when V2 returns a server error', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/permission/perm-1/reply')) {
        return new Response('boom', { status: 500, statusText: 'Internal Server Error' });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const client = new OpenCodeClient(3000);

    await expect(client.respondToPermission('ses-1', 'perm-1', 'once')).rejects.toThrow('500');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/permission/perm-1/reply');
  });
});
