/**
 * @provable/persistence — the tenant data layer.
 *
 * Prisma + Postgres Row-Level Security. The ONLY query entry point is withTenant(),
 * which sets a transaction-local org GUC that RLS enforces. Repositories map rows to
 * @provable/contracts types — Prisma types never leak past this boundary.
 *
 * NOTE: the raw PrismaClient is intentionally NOT exported — there is no un-scoped
 * query path in app code.
 */

export { withTenant } from './tenant.js';
export type { TenantClient } from './tenant.js';
export { disconnect } from './client.js';
export {
  agentRepo,
  decisionRepo,
  orgRepo,
  taskRepo,
  transitionRepo,
  verdictEventRepo,
} from './repositories.js';
export type { DecisionCreateInput, VerdictEventInput } from './repositories.js';
export { mapDecision, mapTransition, mapVerdictEvent, mapScore } from './mappers.js';
export type { ScoreRecord } from './mappers.js';
