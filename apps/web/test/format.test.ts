import { describe, expect, it } from 'vitest';
import { displaySubject, relativeTime, shortSubject } from '../src/lib/format';

const NOW = Date.parse('2026-06-19T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HR = 60 * MIN;
const DAY = 24 * HR;

describe('relativeTime — human, past-only', () => {
  it('renders coarse buckets', () => {
    expect(relativeTime(ago(5_000), NOW)).toBe('just now');
    expect(relativeTime(ago(3 * MIN), NOW)).toBe('3 minutes ago');
    expect(relativeTime(ago(1 * MIN + 30_000), NOW)).toBe('1 minute ago');
    expect(relativeTime(ago(2 * HR), NOW)).toBe('2 hours ago');
    expect(relativeTime(ago(3 * DAY), NOW)).toBe('3 days ago');
    expect(relativeTime(ago(40 * DAY), NOW)).toBe('1 month ago');
    expect(relativeTime(ago(400 * DAY), NOW)).toBe('1 year ago');
  });

  it('never renders a future instant as "in N …"', () => {
    expect(relativeTime(new Date(NOW + 31 * DAY).toISOString(), NOW)).toBe('just now');
  });

  it('passes through an unparseable value rather than throwing', () => {
    expect(relativeTime('not-a-date', NOW)).toBe('not-a-date');
  });
});

describe('shortSubject / displaySubject — no raw user_XXX ever reaches a view', () => {
  it('shortens a Clerk subject to a non-raw tail', () => {
    const short = shortSubject('user_2abcDEF1234567890');
    expect(short).not.toContain('user_');
    expect(short).toBe('…567890');
  });

  it('passes non-Clerk subjects (emails, local:) through untouched', () => {
    expect(shortSubject('maria@acme.com')).toBe('maria@acme.com');
    expect(shortSubject('local:dev@acme.com')).toBe('local:dev@acme.com');
  });

  it('prefers a resolved name, else falls back to the non-raw tail', () => {
    const names = new Map([['user_known', 'Ada Lovelace']]);
    expect(displaySubject('user_known', names)).toBe('Ada Lovelace');
    const fallback = displaySubject('user_2abcDEF1234567890', names);
    expect(fallback).not.toContain('user_');
  });

  it('returns undefined for an absent subject (auto-demotions carry no actor)', () => {
    expect(displaySubject(undefined, new Map())).toBeUndefined();
  });
});
