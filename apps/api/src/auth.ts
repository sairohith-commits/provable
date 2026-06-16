import { createHash, randomBytes } from 'node:crypto';
import type { OrgId } from '@provable/contracts';
import { resolveOrgByApiKey } from '@provable/persistence';

/**
 * Machine-key auth. Keys look like `pvb_<prefix>_<secret>`. We store only the
 * lookup prefix and the sha256 hash of the FULL key — the secret is never persisted
 * or logged. The prefix lets us find the org row; the hash is then compared.
 */
const PREFIX_BYTES = 6;
const SECRET_BYTES = 24;
const KEY_RE = /^pvb_([0-9a-f]+)_[0-9a-f]+$/;

export interface GeneratedKey {
  readonly key: string;
  readonly prefix: string;
  readonly hash: string;
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function generateApiKey(): GeneratedKey {
  const prefix = randomBytes(PREFIX_BYTES).toString('hex');
  const secret = randomBytes(SECRET_BYTES).toString('hex');
  const key = `pvb_${prefix}_${secret}`;
  return { key, prefix, hash: hashApiKey(key) };
}

function parsePrefix(key: string): string | null {
  const m = KEY_RE.exec(key);
  return m?.[1] ?? null;
}

/** Resolve the org for a presented key, or null if missing/malformed/unknown. */
export async function authenticate(rawKey: string | undefined): Promise<OrgId | null> {
  if (rawKey === undefined || rawKey.length === 0) return null;
  const prefix = parsePrefix(rawKey);
  if (prefix === null) return null;
  return resolveOrgByApiKey(prefix, hashApiKey(rawKey));
}

/** Pull the key from `Authorization: Bearer <key>` or `x-api-key`. */
export function extractKey(headers: Record<string, unknown>): string | undefined {
  const auth = headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim();
  const x = headers['x-api-key'];
  return typeof x === 'string' ? x : undefined;
}
