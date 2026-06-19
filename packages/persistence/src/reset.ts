import { PrismaClient } from '@prisma/client';
import type { OrgId } from '@provable/contracts';

/**
 * Single-org HARD RESET (Phase O1) — wipe all agent/governance data for ONE org, keeping the
 * org row, its memberships, and its machine keys so re-onboarding works immediately.
 *
 * CONNECTION: the OWNER/DIRECT_URL (like provision.ts), NOT the app role. Two locked-model facts
 * force this:
 *   1) the app role `provable_app` has NO DELETE grant on any table (the app is append/update-only),
 *   2) RLS is ENABLE (not FORCE), so the owner bypasses RLS.
 * Because RLS cannot scope an owner DELETE, tenant safety is enforced HERE instead, two ways:
 *   • every delete is `WHERE "orgId" = <target>` (parameterized; never interpolated), and
 *   • a TRANSACTIONAL TRIPWIRE: each table's deleted count must equal that table's pre-counted
 *     target-org rows. An over-broad/unscoped delete (e.g. a `where`-less bug) would delete more
 *     than the target's rows → the mismatch throws → the whole transaction ROLLS BACK. So a
 *     "deleted everything" accident is structurally impossible to COMMIT.
 *
 * verdict_event is RETAINED: it is append-only/DB-immutable (a BEFORE DELETE trigger rejects the
 * delete for every role; only TRUNCATE — which can't be org-scoped — bypasses it). Leftover events
 * are inert once their decisions are gone: verdicts materialize onto a decision at INGEST time, so
 * old events never reattach to re-created decisions on re-onboard. They are reported, not deleted.
 *
 * Idempotent: re-running on an already-clean org deletes 0 rows and still succeeds.
 */

/** Per-table counts for the DELETABLE governance set (what the reset removes). */
export interface OrgDataCounts {
  agents: number;
  tasks: number;
  decisions: number;
  transitions: number;
  scores: number;
}

export interface OrgResetReport {
  orgId: string;
  exists: boolean;
  /** Deletable governance rows — counts that WOULD be (dry run) or WERE (confirmed) removed. */
  deletable: OrgDataCounts;
  /** Append-only/immutable rows kept by design (cannot be org-scoped-deleted). */
  retained: { verdictEvents: number };
  /** Rows kept on purpose so the same key/owner re-onboards immediately. */
  kept: { memberships: number; apiKeys: number };
  /** false for a dry run (inspect only); true after a confirmed reset. */
  deleted: boolean;
}

function ownerClient(directUrl: string): PrismaClient {
  if (!directUrl || directUrl.length === 0) {
    throw new Error('[reset] a DIRECT_URL (owner connection) is required — the app role cannot delete.');
  }
  return new PrismaClient({ datasources: { db: { url: directUrl } } });
}

async function countAll(db: PrismaClient, orgId: OrgId): Promise<OrgResetReport> {
  const [agents, tasks, decisions, transitions, scores, verdictEvents, memberships, apiKeys, org] =
    await Promise.all([
      db.agent.count({ where: { orgId } }),
      db.task.count({ where: { orgId } }),
      db.decision.count({ where: { orgId } }),
      db.transition.count({ where: { orgId } }),
      db.score.count({ where: { orgId } }),
      db.verdictEvent.count({ where: { orgId } }),
      db.membership.count({ where: { orgId } }),
      db.apiKey.count({ where: { orgId } }),
      db.org.findUnique({ where: { id: orgId } }),
    ]);
  return {
    orgId,
    exists: org !== null,
    deletable: { agents, tasks, decisions, transitions, scores },
    retained: { verdictEvents },
    kept: { memberships, apiKeys },
    deleted: false,
  };
}

/**
 * DRY RUN — count what a reset WOULD remove for `orgId`, without deleting anything.
 * Caller decides whether the org exists (`report.exists`); this never throws on a missing org.
 */
export async function inspectOrg(directUrl: string, orgId: OrgId): Promise<OrgResetReport> {
  const db = ownerClient(directUrl);
  try {
    return await countAll(db, orgId);
  } finally {
    await db.$disconnect();
  }
}

/**
 * HARD RESET — delete `orgId`'s agent/governance data (agents, tasks, decisions, transitions,
 * scores), keeping the org, memberships, and api keys. Throws if the org does not exist (refuse
 * to act on an unknown id). Returns the report with `deleted: true` and the removed counts.
 */
export async function resetOrgData(directUrl: string, orgId: OrgId): Promise<OrgResetReport> {
  if (!orgId || orgId.trim().length === 0) {
    throw new Error('[reset] refusing to run: orgId is empty.');
  }
  const db = ownerClient(directUrl);
  try {
    const before = await countAll(db, orgId);
    if (!before.exists) {
      throw new Error(`[reset] org "${orgId}" not found — refusing to run.`);
    }

    await db.$transaction(async (tx) => {
      // FK-safe order: decisions reference task+agent; tasks reference agent.
      const steps: { name: keyof OrgDataCounts; run: () => Promise<{ count: number }> }[] = [
        { name: 'decisions', run: () => tx.decision.deleteMany({ where: { orgId } }) },
        { name: 'transitions', run: () => tx.transition.deleteMany({ where: { orgId } }) },
        { name: 'scores', run: () => tx.score.deleteMany({ where: { orgId } }) },
        { name: 'tasks', run: () => tx.task.deleteMany({ where: { orgId } }) },
        { name: 'agents', run: () => tx.agent.deleteMany({ where: { orgId } }) },
      ];
      for (const step of steps) {
        const expected = before.deletable[step.name];
        const { count } = await step.run();
        // TRIPWIRE: an org-scoped delete can only remove this org's rows, so the count MUST equal
        // the pre-counted target rows. Any deviation (an unscoped/over-broad delete) rolls back.
        if (count !== expected) {
          throw new Error(
            `[reset] tripwire: deleting ${step.name} removed ${count} rows but expected ${expected} for org "${orgId}" — rolling back.`,
          );
        }
      }
    });

    return { ...before, deleted: true };
  } finally {
    await db.$disconnect();
  }
}
