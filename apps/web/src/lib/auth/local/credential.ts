// Local bootstrapped-admin credential. The admin password is stored ONLY as a bcrypt hash in
// env (LOCAL_ADMIN_PASSWORD_HASH) — never plaintext — and verified with bcrypt's constant-time
// compare. Pure module (no `server-only`/next): unit-testable. For air-gapped/trial instances.
import { compare } from 'bcryptjs';
import type { Identity } from '../context';

const BCRYPT_HASH_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

/** A bootstrapped-admin row materialized from env at request time (single-org instance). */
export interface LocalAdmin {
  readonly email: string;
  readonly passwordHash: string;
}

/** Read + sanity-check the seeded admin from env. Throws (loudly) if the hash is malformed. */
export function loadLocalAdmin(): LocalAdmin {
  const email = process.env['LOCAL_ADMIN_EMAIL'];
  const passwordHash = process.env['LOCAL_ADMIN_PASSWORD_HASH'];
  if (email === undefined || email.length === 0) {
    throw new Error('[auth] LOCAL_ADMIN_EMAIL is not set.');
  }
  if (passwordHash === undefined || !BCRYPT_HASH_RE.test(passwordHash)) {
    throw new Error(
      '[auth] LOCAL_ADMIN_PASSWORD_HASH must be a bcrypt hash ($2a/$2b/$2y$<cost>$...), not plaintext.',
    );
  }
  return { email, passwordHash };
}

/**
 * Verify presented credentials against the seeded admin. Email is matched case-insensitively;
 * the password is checked with bcrypt's constant-time compare against the stored hash. Returns
 * the admin Identity on success, or null on any mismatch — callers MUST NOT distinguish which
 * field failed in their response.
 */
export async function verifyLocalCredentials(
  email: string,
  password: string,
  admin: LocalAdmin = loadLocalAdmin(),
): Promise<Identity | null> {
  const emailOk = email.trim().toLowerCase() === admin.email.trim().toLowerCase();
  // Always run the bcrypt compare (even on email mismatch) so timing does not reveal whether
  // the email was correct.
  const passwordOk = await compare(password, admin.passwordHash);
  if (!emailOk || !passwordOk) return null;
  return { userId: `local:${admin.email}`, email: admin.email, displayName: 'Local admin' };
}
