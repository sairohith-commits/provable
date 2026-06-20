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
  apiKeyRepo,
  connectorConfigRepo,
  decisionRepo,
  guardrailRuleRepo,
  orgRepo,
  scoreRepo,
  taskRepo,
  transitionRepo,
  verdictEventRepo,
} from './repositories.js';
export type {
  AgentRecord,
  ApiKeyRow,
  ConnectorConfigRow,
  ConnectorCreateInput,
  ConnectorSourceSecret,
  DecisionCreateInput,
  GuardrailRuleRow,
  GuardrailRuleCreateInput,
  VerdictEventInput,
} from './repositories.js';
export { mapDecision, mapTransition, mapVerdictEvent, mapScore } from './mappers.js';
export type { ScoreRecord } from './mappers.js';
export { makeRecomputePorts } from './recompute-ports.js';
export type { RecomputePorts } from './recompute-ports.js';
export { resolveOrgByApiKey, resolveOrgByClerkOrgId, resolveGatewayByApiKey } from './auth.js';
export type { GatewayKeyResolution } from './auth.js';
export {
  assertRlsScopedConnection,
  checkRlsScopedConnection,
  RlsScopeError,
} from './rls-assert.js';
export type { RlsConnectionStatus } from './rls-assert.js';
export { provisionOrg, linkClerkOrg, assignRole, bootstrapAppRole } from './provision.js';
export { inspectOrg, resetOrgData } from './reset.js';
export type { OrgDataCounts, OrgResetReport } from './reset.js';
export { membershipRepo, normalizeEmail } from './membership.js';
export type { MemberRow } from './membership.js';
export { readModelRepo } from './read-models.js';
export type {
  RegistryView,
  RegistryAgentRow,
  VisibilityView,
  VisibilityRow,
  VerdictMix,
  ScoreComponents,
  ScoreTrendPoint,
  CostView,
  CostRow,
  SafetyView,
  SuspendedTask,
} from './read-models.js';
