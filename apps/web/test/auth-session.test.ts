import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SESSION_REFRESH_THRESHOLD_SECONDS,
  createSession,
  readSession,
  shouldRefresh,
} from '../src/lib/auth/session';

const SECRET = 'session-secret-at-least-32-chars-long!!';
const saved = process.env['AUTH_SESSION_SECRET'];
beforeEach(() => {
  process.env['AUTH_SESSION_SECRET'] = SECRET;
});
afterEach(() => {
  if (saved === undefined) delete process.env['AUTH_SESSION_SECRET'];
  else process.env['AUTH_SESSION_SECRET'] = saved;
});

const payload = {
  sub: 'user-1',
  email: 'a@b.com',
  name: 'Agent Smith',
  provider: 'local' as const,
};

describe('session lifecycle', () => {
  it('round-trips a signed session', async () => {
    const token = await createSession(payload);
    const read = await readSession(token, 'local');
    expect(read).toMatchObject({ sub: 'user-1', email: 'a@b.com', name: 'Agent Smith', provider: 'local' });
  });

  it('rejects an expired session (expiry collapses to signed-out)', async () => {
    const token = await createSession(payload, -1); // already expired
    expect(await readSession(token, 'local')).toBeNull();
  });

  it('rejects a tampered or empty token', async () => {
    expect(await readSession(undefined, 'local')).toBeNull();
    expect(await readSession('not.a.jwt', 'local')).toBeNull();
    const token = await createSession(payload);
    expect(await readSession(`${token}x`, 'local')).toBeNull();
  });

  it('will not verify a cookie under a different provider key', async () => {
    const token = await createSession(payload);
    expect(await readSession(token, 'oidc')).toBeNull();
  });

  it('flags sliding refresh only inside the refresh window', async () => {
    const fresh = await createSession(payload); // full 8h TTL
    expect(shouldRefresh(fresh)).toBe(false);
    const nearExpiry = await createSession(payload, SESSION_REFRESH_THRESHOLD_SECONDS - 10);
    expect(shouldRefresh(nearExpiry)).toBe(true);
  });

  it('preserves an OIDC refresh token across the round-trip', async () => {
    const token = await createSession({ ...payload, provider: 'oidc', oidcRefreshToken: 'rt-123' });
    const read = await readSession(token, 'oidc');
    expect(read?.oidcRefreshToken).toBe('rt-123');
  });
});
