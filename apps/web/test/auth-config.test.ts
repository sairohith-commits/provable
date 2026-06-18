import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  activeProviderType,
  assertActiveConfig,
  assertSessionSecret,
} from '../src/lib/auth/config';

// Keys the auth config reads. Cleared before each test so cases are independent.
const KEYS = [
  'AUTH_PROVIDER',
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'CLERK_SECRET_KEY',
  'OIDC_ISSUER',
  'OIDC_CLIENT_ID',
  'OIDC_CLIENT_SECRET',
  'OIDC_REDIRECT_URI',
  'LOCAL_ADMIN_EMAIL',
  'LOCAL_ADMIN_PASSWORD_HASH',
  'WORKSPACE_ORG_ID',
  'AUTH_SESSION_SECRET',
] as const;

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const SECRET = 'x'.repeat(32);

describe('provider selection', () => {
  it('defaults to clerk when AUTH_PROVIDER is unset (the existing deploy is unchanged)', () => {
    expect(activeProviderType()).toBe('clerk');
  });

  it('honors an explicit valid provider', () => {
    process.env['AUTH_PROVIDER'] = 'oidc';
    expect(activeProviderType()).toBe('oidc');
  });

  it('fails loudly on an unknown provider — no silent fallback', () => {
    process.env['AUTH_PROVIDER'] = 'auth0';
    expect(() => activeProviderType()).toThrow(/invalid/i);
  });
});

describe('startup validation — fail fast, fail clear', () => {
  it('clerk: requires the Clerk keys', () => {
    process.env['AUTH_PROVIDER'] = 'clerk';
    expect(() => assertActiveConfig()).toThrow(/NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY/);
    process.env['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'] = 'pk_test_x';
    process.env['CLERK_SECRET_KEY'] = 'sk_test_x';
    expect(assertActiveConfig()).toBe('clerk');
  });

  it('oidc: requires issuer/client/redirect + workspace org + session secret', () => {
    process.env['AUTH_PROVIDER'] = 'oidc';
    expect(() => assertActiveConfig()).toThrow(/OIDC_ISSUER/);
    process.env['OIDC_ISSUER'] = 'https://issuer.example.com';
    process.env['OIDC_CLIENT_ID'] = 'provable';
    process.env['OIDC_CLIENT_SECRET'] = 'secret';
    process.env['OIDC_REDIRECT_URI'] = 'https://app/api/auth/callback';
    expect(() => assertActiveConfig()).toThrow(/WORKSPACE_ORG_ID/);
    process.env['WORKSPACE_ORG_ID'] = 'org_1';
    expect(() => assertActiveConfig()).toThrow(/AUTH_SESSION_SECRET/);
    process.env['AUTH_SESSION_SECRET'] = SECRET;
    expect(assertActiveConfig()).toBe('oidc');
  });

  it('local: requires admin email + bcrypt hash + workspace org + session secret', () => {
    process.env['AUTH_PROVIDER'] = 'local';
    expect(() => assertActiveConfig()).toThrow(/LOCAL_ADMIN_EMAIL/);
    process.env['LOCAL_ADMIN_EMAIL'] = 'admin@example.com';
    process.env['LOCAL_ADMIN_PASSWORD_HASH'] = '$2b$12$abcdefghijklmnopqrstuv';
    process.env['WORKSPACE_ORG_ID'] = 'org_1';
    process.env['AUTH_SESSION_SECRET'] = SECRET;
    expect(assertActiveConfig()).toBe('local');
  });

  it('rejects a missing or too-short AUTH_SESSION_SECRET', () => {
    expect(() => assertSessionSecret('local')).toThrow(/AUTH_SESSION_SECRET/);
    process.env['AUTH_SESSION_SECRET'] = 'short';
    expect(() => assertSessionSecret('local')).toThrow(/at least 32/);
    process.env['AUTH_SESSION_SECRET'] = SECRET;
    expect(assertSessionSecret('local')).toBe(SECRET);
  });
});
