import { hashSync } from 'bcryptjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadLocalAdmin, verifyLocalCredentials } from '../src/lib/auth/local/credential';

const EMAIL = 'admin@example.com';
const PASSWORD = 'correct horse battery staple';
const HASH = hashSync(PASSWORD, 10);

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ['LOCAL_ADMIN_EMAIL', 'LOCAL_ADMIN_PASSWORD_HASH']) saved[k] = process.env[k];
  process.env['LOCAL_ADMIN_EMAIL'] = EMAIL;
  process.env['LOCAL_ADMIN_PASSWORD_HASH'] = HASH;
});
afterEach(() => {
  for (const k of ['LOCAL_ADMIN_EMAIL', 'LOCAL_ADMIN_PASSWORD_HASH']) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('local admin credential', () => {
  it('accepts the seeded admin and returns an Identity', async () => {
    const id = await verifyLocalCredentials(EMAIL, PASSWORD);
    expect(id).not.toBeNull();
    expect(id?.email).toBe(EMAIL);
    expect(id?.userId).toBe(`local:${EMAIL}`);
  });

  it('is case-insensitive on email', async () => {
    expect(await verifyLocalCredentials('ADMIN@EXAMPLE.COM', PASSWORD)).not.toBeNull();
  });

  it('rejects a wrong password (constant-time bcrypt compare, not plaintext)', async () => {
    expect(await verifyLocalCredentials(EMAIL, 'wrong')).toBeNull();
  });

  it('rejects an unknown email', async () => {
    expect(await verifyLocalCredentials('nope@example.com', PASSWORD)).toBeNull();
  });

  it('refuses a plaintext (non-bcrypt) password hash in env', () => {
    process.env['LOCAL_ADMIN_PASSWORD_HASH'] = 'plaintextpassword';
    expect(() => loadLocalAdmin()).toThrow(/bcrypt hash/);
  });
});
