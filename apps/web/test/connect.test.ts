import { describe, expect, it } from 'vitest';
import { maskedKey, quickstart } from '../src/lib/connect';

describe('Connect quickstart — real SDK surface, no gateway', () => {
  const snippet = quickstart('http://localhost:3010', '<YOUR_API_KEY>');

  it('matches the actual Phase-5 provable_sdk surface', () => {
    expect(snippet).toContain('pip install provable_sdk');
    expect(snippet).toContain('from provable_sdk import Client');
    expect(snippet).toContain('client.register(');
    expect(snippet).toContain('client.track(');
    expect(snippet).toContain('verdict=Verdict(kind=VerdictKind.ACCEPTED)');
    expect(snippet).toContain('source=Source.SDK');
    expect(snippet).toContain('external_ref=');
  });

  it('shows the real API base URL and the key placeholder', () => {
    expect(snippet).toContain('http://localhost:3010');
    expect(snippet).toContain('<YOUR_API_KEY>');
  });

  it('shows NO gateway / no-code endpoint (the gateway is not built here)', () => {
    expect(snippet.toLowerCase()).not.toContain('gateway');
    expect(snippet).not.toContain('/proxy');
    expect(snippet).not.toContain('/v1/');
  });
});

describe('masked key prefix', () => {
  it('masks the secret, keeps the lookup prefix', () => {
    expect(maskedKey('abc123')).toBe('pvb_abc123_••••••••••••');
    expect(maskedKey('abc123')).not.toMatch(/pvb_abc123_[0-9a-f]/); // no real secret shown
  });
  it('honest state when no key provisioned', () => {
    expect(maskedKey(null)).toBe('no key provisioned');
  });
});
