import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
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

// ── Internal (web↔api) auth: shared token + org-id from the web's VERIFIED Clerk session.
//    Honored ONLY on the read routes + the approve route; never on /track or /register.

/**
 * Constant-time compare of the presented internal token against PROVABLE_INTERNAL_TOKEN.
 * Length guard first (timingSafeEqual throws on unequal lengths) → a bad token is a 401,
 * never a 500. Returns false if the env token is unset/empty (fail closed).
 */
export function internalTokenValid(presented: string | undefined): boolean {
  const expected = process.env['PROVABLE_INTERNAL_TOKEN'];
  if (expected === undefined || expected.length === 0) return false;
  if (presented === undefined || presented.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}

export interface InternalContext {
  readonly orgId: OrgId;
  readonly approver: string | undefined;
  /** Stable provider subject (AuthContext.userId) — the AUTHORITATIVE key the API uses to
   *  re-derive the caller's RBAC role from the membership store (Phase B). */
  readonly subject: string | undefined;
}

/**
 * Resolve the internal caller. Requires a valid internal token AND an org id (the web
 * sends the Provable orgId it resolved from the verified Clerk session — never client
 * input). Returns null when the token is absent/invalid or the org id is missing.
 *
 * `subject` is carried for RBAC role resolution. Note: the API does NOT trust a web-supplied
 * role — `x-provable-role` (if present) is a non-authoritative UX hint only; enforcement
 * re-derives the role from membership(orgId, subject). See app.ts requireInternalPermission.
 */
export function resolveInternal(headers: Record<string, unknown>): InternalContext | null {
  const token = headers['x-provable-internal-token'];
  if (typeof token !== 'string' || !internalTokenValid(token)) return null;
  const orgId = headers['x-provable-org-id'];
  if (typeof orgId !== 'string' || orgId.length === 0) return null;
  const approver = headers['x-provable-approver'];
  const subject = headers['x-provable-subject'];
  return {
    orgId: orgId as OrgId,
    approver: typeof approver === 'string' ? approver : undefined,
    subject: typeof subject === 'string' ? subject : undefined,
  };
}

/** True iff a valid internal token is present (org id not required) — for /resolve-org. */
export function hasValidInternalToken(headers: Record<string, unknown>): boolean {
  const token = headers['x-provable-internal-token'];
  return typeof token === 'string' && internalTokenValid(token);
}
