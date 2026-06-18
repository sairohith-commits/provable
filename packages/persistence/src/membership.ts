import { Prisma } from '@prisma/client';
import type { OrgId, Role } from '@provable/contracts';
import type { TenantClient } from './tenant.js';

// RBAC membership repository (Phase B). All queries run inside withTenant(), so RLS scopes
// every row to the current org — there is no cross-org read path here (unlike machine-key /
// Clerk org resolution, which must run before tenant context and use SECURITY DEFINER funcs).

export interface MemberRow {
  readonly email: string;
  readonly subject: string | null;
  readonly role: Role;
  readonly boundAt: string | null;
  readonly createdAt: string;
}

/** Invites are keyed by a normalized (lowercased, trimmed) email. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

export const membershipRepo = {
  /** The role bound to this provider subject in this org, or null if unassigned. */
  async findRoleBySubject(tx: TenantClient, orgId: OrgId, subject: string): Promise<Role | null> {
    const row = await tx.membership.findFirst({ where: { orgId, subject } });
    return row?.role ?? null;
  },

  /**
   * Resolve the caller's role, binding a pending invite on first login. Binding requires a
   * provider-VERIFIED email (caller passes emailVerified) so an unverified address can never
   * claim an invite. Idempotent under a concurrent first-login race: if the unique(orgId,
   * subject) bind collides, we catch and re-read the now-bound row rather than 500.
   * Returns the role, or null when the caller has no membership/invite (= no access).
   */
  async resolveOrBind(
    tx: TenantClient,
    orgId: OrgId,
    subject: string,
    email: string | null,
    emailVerified: boolean,
  ): Promise<Role | null> {
    const bound = await tx.membership.findFirst({ where: { orgId, subject } });
    if (bound !== null) return bound.role;

    if (email === null || !emailVerified) return null; // bind only on a verified email
    const norm = normalizeEmail(email);
    const invite = await tx.membership.findFirst({ where: { orgId, email: norm, subject: null } });
    if (invite === null) return null;

    try {
      await tx.membership.update({
        where: { id: invite.id },
        data: { subject, boundAt: new Date() },
      });
      return invite.role;
    } catch (e) {
      if (isUniqueViolation(e)) {
        const winner = await tx.membership.findFirst({ where: { orgId, subject } });
        return winner?.role ?? invite.role;
      }
      throw e;
    }
  },

  /** Upsert an invite by email (create pending, or update the role of an existing membership). */
  async invite(
    tx: TenantClient,
    orgId: OrgId,
    email: string,
    role: Role,
    invitedBySubject: string,
  ): Promise<void> {
    const norm = normalizeEmail(email);
    await tx.membership.upsert({
      where: { orgId_email: { orgId, email: norm } },
      create: { orgId, email: norm, role, invitedBySubject },
      update: { role },
    });
  },

  /** Change an existing member's role (by email). No-op semantics if absent (caller checks). */
  async setRole(tx: TenantClient, orgId: OrgId, email: string, role: Role): Promise<void> {
    await tx.membership.update({
      where: { orgId_email: { orgId, email: normalizeEmail(email) } },
      data: { role },
    });
  },

  /** Remove a member (by email). */
  async remove(tx: TenantClient, orgId: OrgId, email: string): Promise<void> {
    await tx.membership.delete({
      where: { orgId_email: { orgId, email: normalizeEmail(email) } },
    });
  },

  async getByEmail(tx: TenantClient, orgId: OrgId, email: string): Promise<MemberRow | null> {
    const row = await tx.membership.findUnique({
      where: { orgId_email: { orgId, email: normalizeEmail(email) } },
    });
    return row === null ? null : toMemberRow(row);
  },

  /** Owner count — the last-Owner guard (API) refuses to demote/remove the final OWNER. */
  async countOwners(tx: TenantClient, orgId: OrgId): Promise<number> {
    return tx.membership.count({ where: { orgId, role: 'OWNER' } });
  },

  async list(tx: TenantClient, orgId: OrgId): Promise<MemberRow[]> {
    const rows = await tx.membership.findMany({
      where: { orgId },
      orderBy: [{ role: 'asc' }, { email: 'asc' }],
    });
    return rows.map(toMemberRow);
  },
};

interface MembershipRecord {
  email: string;
  subject: string | null;
  role: Role;
  boundAt: Date | null;
  createdAt: Date;
}

function toMemberRow(r: MembershipRecord): MemberRow {
  return {
    email: r.email,
    subject: r.subject,
    role: r.role,
    boundAt: r.boundAt === null ? null : r.boundAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  };
}
