import type { AgentIdentityState, AgentKey, OrgId, Permission, Role, TaskKey } from '@provable/contracts';
import { ROLES, can } from '@provable/contracts';
import { DEFAULT_GOVERNANCE_POLICY, computeReadiness, manualOverride, stepLifecycle, transitionIdentity } from '@provable/core';
import type { IdentityEvent, TaskScope } from '@provable/core';
import {
  agentRepo,
  apiKeyRepo,
  makeRecomputePorts,
  membershipRepo,
  readModelRepo,
  resolveOrgByClerkOrgId,
  scoreRepo,
  taskRepo,
  transitionRepo,
  withTenant,
} from '@provable/persistence';
import { generateApiKey } from './auth.js';
import { registerAnthropicGateway } from './anthropic-gateway.js';
import { registerConnector } from './connector.js';
import { buildFleetOverview } from './fleet.js';
import { registerGateway } from './gateway.js';
import {
  deriveDisplayStatus,
  deriveFidelity,
  deriveIdentityState,
  deriveRoi,
  IDENTITY_POLICY,
  OBSERVE_ONLY_UPGRADE,
} from './views.js';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  authenticate,
  extractKey,
  hasValidInternalToken,
  resolveInternal,
} from './auth.js';
import { recompute } from './recompute.js';
import { registerSchema, trackSchema } from './schemas.js';
import type { TrackBody } from './schemas.js';

export interface BuildAppOptions {
  readonly logger?: boolean;
}

/** Machine keys may emit drift/guardrail signals, but NOT manual approvals — approval is
 *  the Clerk-authed human path only. Strip any manual signal from a /track payload. */
function stripManualSignal(body: TrackBody): TrackBody {
  if (body.signals?.manual === undefined) return body;
  const { manual: _manual, ...rest } = body.signals;
  return { ...body, signals: rest };
}

export function buildApp(opts?: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: opts?.logger
      ? {
          redact: [
            'req.headers.authorization',
            'req.headers["x-api-key"]',
            'req.headers["x-provable-key"]',
            'req.headers["x-provable-internal-token"]',
          ],
        }
      : false,
  });

  // Accept an empty application/json body (the approve POST carries no body) while still
  // parsing real JSON and 400-ing on malformed JSON.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = body as string;
    if (text === undefined || text.length === 0) return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  const headersOf = (req: FastifyRequest) => req.headers as Record<string, unknown>;

  // Liveness probe for the platform health check (Render). Unauthenticated, no DB touch —
  // it answers "is the process up and serving?", nothing tenant-scoped.
  app.get('/health', async () => ({ status: 'ok' }));

  /** Machine-key only (ingestion: /register, /track). Internal token is NOT honored here. */
  async function requireMachineOrg(req: FastifyRequest, reply: FastifyReply): Promise<OrgId | null> {
    const orgId = await authenticate(extractKey(headersOf(req)));
    if (orgId === null) {
      await reply.code(401).send({ error: 'unauthorized' });
      return null;
    }
    return orgId;
  }

  /** Authoritatively resolve the internal caller's role from membership(orgId, subject).
   *  Returns null when there is no subject or no assigned membership (= no access). */
  async function resolveRole(orgId: OrgId, subject: string | undefined): Promise<Role | null> {
    if (subject === undefined || subject.length === 0) return null;
    return withTenant(orgId, (tx) => membershipRepo.findRoleBySubject(tx, orgId, subject));
  }

  /**
   * Gate a MUTATION on a specific permission. Deny-by-default and API-AUTHORITATIVE: the role
   * is re-derived server-side from the membership store (never trusted from a header). 401 if
   * not an internal caller; 403 if unassigned or the role lacks the permission. Machine keys
   * never produce an internal context, so they can never reach a governance mutation.
   */
  async function requireInternalPermission(
    req: FastifyRequest,
    reply: FastifyReply,
    permission: Permission,
  ): Promise<{ ctx: NonNullable<ReturnType<typeof resolveInternal>>; role: Role } | null> {
    const internal = resolveInternal(headersOf(req));
    if (internal === null) {
      await reply.code(401).send({ error: 'internal auth required' });
      return null;
    }
    const role = await resolveRole(internal.orgId, internal.subject);
    if (role === null) {
      await reply.code(403).send({ error: 'no role assigned' });
      return null;
    }
    if (!can(role, permission)) {
      await reply.code(403).send({ error: 'forbidden', need: permission });
      return null;
    }
    return { ctx: internal, role };
  }

  /** Reads: internal (web, role-gated — ANY assigned role) OR machine-key (agents, unchanged). */
  async function requireReadOrg(req: FastifyRequest, reply: FastifyReply): Promise<OrgId | null> {
    const internal = resolveInternal(headersOf(req));
    if (internal !== null) {
      // Internal (human) read path requires an assigned role (deny-by-default).
      const role = await resolveRole(internal.orgId, internal.subject);
      if (role === null) {
        await reply.code(403).send({ error: 'no role assigned' });
        return null;
      }
      return internal.orgId;
    }
    // A bad/partial internal token with no machine key falls through to machine-key auth,
    // which 401s — so a malformed internal call is rejected, not silently downgraded.
    const orgId = await authenticate(extractKey(headersOf(req)));
    if (orgId === null) {
      await reply.code(401).send({ error: 'unauthorized' });
      return null;
    }
    return orgId;
  }

  // ── Ingestion (machine-key only) ───────────────────────────────────────────
  app.post('/register', async (req, reply) => {
    const orgId = await requireMachineOrg(req, reply);
    if (orgId === null) return;
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid payload', issues: parsed.error.issues });
    }
    const { agentKey, taskKey } = parsed.data;
    await withTenant(orgId, async (tx) => {
      await agentRepo.ensure(tx, orgId, agentKey as AgentKey);
      if (taskKey !== undefined) {
        await taskRepo.ensure(tx, orgId, agentKey as AgentKey, taskKey as TaskKey);
      }
    });
    return reply.send({ ok: true, agentKey, ...(taskKey !== undefined ? { taskKey } : {}) });
  });

  app.post('/track', async (req, reply) => {
    const orgId = await requireMachineOrg(req, reply);
    if (orgId === null) return;
    const parsed = trackSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid payload', issues: parsed.error.issues });
    }
    // Machine keys cannot approve via the ingestion path (retires the 6a marker workaround).
    const result = await recompute(orgId, stripManualSignal(parsed.data));
    if ('notFound' in result) {
      return reply.code(404).send({ error: 'no decision for externalRef' });
    }
    return reply.send(result);
  });

  // ── Reads (internal OR machine-key) ─────────────────────────────────────────
  app.get('/agents', async (req, reply) => {
    const orgId = await requireReadOrg(req, reply);
    if (orgId === null) return;
    const agents = await withTenant(orgId, async (tx) => {
      const tasks = await taskRepo.list(tx);
      return Promise.all(
        tasks.map(async (t) => ({
          agentKey: t.agentKey,
          taskKey: t.taskKey,
          effectiveMode: t.effectiveMode,
          score: await scoreRepo.latest(tx, orgId, t.agentKey, t.taskKey),
        })),
      );
    });
    return reply.send({ agents });
  });

  app.get('/agents/:agentKey/tasks/:taskKey', async (req, reply) => {
    const orgId = await requireReadOrg(req, reply);
    if (orgId === null) return;
    const { agentKey, taskKey } = req.params as { agentKey: string; taskKey: string };
    const body = await withTenant(orgId, async (tx) => {
      const effectiveMode = await taskRepo.findEffectiveMode(
        tx,
        orgId,
        agentKey as AgentKey,
        taskKey as TaskKey,
      );
      if (effectiveMode === null) return null;
      const score = await scoreRepo.latest(tx, orgId, agentKey as AgentKey, taskKey as TaskKey);
      return { agentKey, taskKey, effectiveMode, score };
    });
    if (body === null) return reply.code(404).send({ error: 'unknown agent×task' });
    return reply.send(body);
  });

  app.get('/transitions', async (req, reply) => {
    const orgId = await requireReadOrg(req, reply);
    if (orgId === null) return;
    const transitions = await withTenant(orgId, (tx) => transitionRepo.list(tx));
    return reply.send({ transitions });
  });

  // ── Pillar read-models (internal OR machine-key) ────────────────────────────
  // Identity & Registry: identity state (DERIVED from real activity), first/last-seen,
  // provenance sources, task count.
  app.get('/registry', async (req, reply) => {
    const orgId = await requireReadOrg(req, reply);
    if (orgId === null) return;
    const asOf = new Date().toISOString();
    const view = await withTenant(orgId, (tx) => readModelRepo.registry(tx));
    const agents = view.agents.map((a) => ({
      ...a,
      identityState: deriveIdentityState(a, asOf),
    }));
    return reply.send({ agents, policy: IDENTITY_POLICY });
  });

  // Visibility & Intelligence: per agent×task verdict mix, volumes, window rates +
  // readiness components, and the score trend (the only drift signal core computes).
  app.get('/visibility', async (req, reply) => {
    const orgId = await requireReadOrg(req, reply);
    if (orgId === null) return;
    const asOf = new Date().toISOString();
    const view = await withTenant(orgId, (tx) => readModelRepo.visibility(tx, asOf));
    // Attach integration fidelity per task: Observe-only (gateway: cost/activity, no verdicts) →
    // readiness stays honest N/A + upgrade prompt; never a fabricated score.
    const tasks = view.tasks.map((t) => ({ ...t, fidelity: deriveFidelity(t) }));
    return reply.send({ ...view, tasks, observeOnlyUpgrade: OBSERVE_ONLY_UPGRADE });
  });

  // Cost & ROI: REAL cost aggregates + a DERIVED ROI/shadow-counterfactual projection that
  // always travels with its assumptions (ROI-integrity: no savings figure without inputs).
  app.get('/cost', async (req, reply) => {
    const orgId = await requireReadOrg(req, reply);
    if (orgId === null) return;
    const cost = await withTenant(orgId, (tx) => readModelRepo.cost(tx));
    const shadowDecisionVolume = cost.tasks
      .filter((t) => t.effectiveMode === 'SHADOW')
      .reduce((sum, t) => sum + t.decisionCount, 0);
    const roi = deriveRoi(cost, shadowDecisionVolume);
    return reply.send({ ...cost, roi });
  });

  // Guardrails & Safety: safety-triggered auto-demotions (GUARDRAIL + SIGNAL_LOSS) with
  // their tripping context, plus currently SUSPENDED tasks. Empty until something trips.
  app.get('/guardrails', async (req, reply) => {
    const orgId = await requireReadOrg(req, reply);
    if (orgId === null) return;
    const view = await withTenant(orgId, (tx) => readModelRepo.safety(tx));
    return reply.send(view);
  });

  // ── Phase C2: gateway proxy (Tier 1, Observe-only). Machine-key data path; never reaches the
  //    human onboarding actions. Registered here as the interim home (refactors to adapters/gateway).
  registerGateway(app);

  // ── Phase O2: transparent Anthropic /v1/messages proxy (Tier 1, Observe-only). Per-agent
  //    gateway key in the URL path → org+agent+task; the caller's Anthropic key is forwarded
  //    upstream and never stored. Vendor specifics + price table live in @provable/adapters.
  registerAnthropicGateway(app);

  // ── Phase C3: connector data path (Tier 2). Machine-key auth; the reference connector maps the
  //    agent's existing events → canonical Decisions, ingested via recompute. Mapping lives in
  //    @provable/adapters (anti-corruption boundary); the tenant is the machine-key org.
  registerConnector(app);

  // KPI summary: composed REAL counts + the ROI projection (assumptions attached). Honest
  // zeros on a fresh org; the api key PREFIX (lookup handle, not the secret) for the Connect view.
  app.get('/summary', async (req, reply) => {
    const orgId = await requireReadOrg(req, reply);
    if (orgId === null) return;
    const asOf = new Date().toISOString();
    const { registry, cost, safety, fleet, apiKeyPrefix } = await withTenant(
      orgId,
      async (tx) => ({
        registry: await readModelRepo.registry(tx),
        cost: await readModelRepo.cost(tx),
        safety: await readModelRepo.safety(tx),
        // KPIs derive from the SAME fleet views as /overview/fleet — no independent counter that
        // could double-count. pendingApprovals == promotableNow (a live, actionable promotion).
        fleet: await buildFleetOverview(tx, orgId),
        apiKeyPrefix: await readModelRepo.apiKeyPrefix(tx, orgId),
      }),
    );
    const pendingApprovals = fleet.kpis.promotableNow;
    const activeAgents = registry.agents.filter(
      (a) => deriveIdentityState(a, asOf) === 'ACTIVE',
    ).length;
    const shadowDecisionVolume = cost.tasks
      .filter((t) => t.effectiveMode === 'SHADOW')
      .reduce((sum, t) => sum + t.decisionCount, 0);
    const roi = deriveRoi(cost, shadowDecisionVolume);
    return reply.send({
      activeAgents,
      agentsTotal: registry.agents.length,
      pendingApprovals,
      suspendedCount: safety.suspended.length,
      guardrailEventCount: safety.events.length,
      decisionCount: cost.org.decisionCount,
      tokenSpend: cost.org.tokens,
      usdSpend: cost.org.usd,
      hasCostSignal: cost.org.hasCostSignal,
      roi,
      apiKeyPrefix,
      fleetKpis: fleet.kpis,
    });
  });

  // ── Fleet governance read-model (Phase U1): one derived status per task + reconciled KPIs ──
  app.get('/overview/fleet', async (req, reply) => {
    const orgId = await requireReadOrg(req, reply);
    if (orgId === null) return;
    const fleet = await withTenant(orgId, (tx) => buildFleetOverview(tx, orgId));
    return reply.send(fleet);
  });

  // ── Connect-page ROTATE (single-active-key semantics, on the multi-key table) ────────
  // Mints a new key and revokes EVERY other active key for the org, returning the plaintext
  // ONCE. The old key dies immediately (auth_resolve_org ignores revoked keys). A MACHINE KEY
  // CANNOT reach this — there is no internal context. Same manage_keys gate as the C1 keys.
  app.post('/org/api-key/rotate', async (req, reply) => {
    const auth = await requireInternalPermission(req, reply, 'manage_keys');
    if (auth === null) return;
    const orgId = auth.ctx.orgId;
    const k = generateApiKey();
    await withTenant(orgId, async (tx) => {
      await apiKeyRepo.mint(tx, orgId, k.prefix, k.hash, 'rotated');
      await apiKeyRepo.revokeOthers(tx, orgId, k.prefix);
    });
    return reply.send({ key: k.key, prefix: k.prefix }); // shown ONCE; never stored in clear
  });

  // ── Clerk org → Provable org resolve (internal token only; no org id needed) ──
  app.get('/resolve-org', async (req, reply) => {
    if (!hasValidInternalToken(headersOf(req))) {
      return reply.code(401).send({ error: 'internal auth required' });
    }
    const { clerkOrgId } = req.query as { clerkOrgId?: string };
    if (typeof clerkOrgId !== 'string' || clerkOrgId.length === 0) {
      return reply.code(400).send({ error: 'clerkOrgId required' });
    }
    const orgId = await resolveOrgByClerkOrgId(clerkOrgId);
    if (orgId === null) return reply.code(404).send({ error: 'no org linked to that Clerk org' });
    return reply.send({ orgId });
  });

  // ── Approve a pending promotion (Clerk-authed human path ONLY) ──────────────
  app.post('/agents/:agentKey/tasks/:taskKey/approve', async (req, reply) => {
    // INTERNAL ONLY + permission-gated: a machine key cannot reach this (no internal context),
    // and an internal caller needs the approve_transition permission (OWNER/APPROVER).
    const auth = await requireInternalPermission(req, reply, 'approve_transition');
    if (auth === null) return;
    const internal = auth.ctx;
    if (internal.approver === undefined || internal.approver.length === 0) {
      return reply.code(400).send({ error: 'approver required' });
    }
    const { agentKey, taskKey } = req.params as { agentKey: string; taskKey: string };
    const orgId = internal.orgId;
    const approver = internal.approver;
    const asOf = new Date().toISOString();

    const result = await withTenant(orgId, async (tx) => {
      const ports = makeRecomputePorts(tx);
      const scope: TaskScope = {
        orgId,
        agentKey: agentKey as AgentKey,
        taskKey: taskKey as TaskKey,
      };
      const state = await ports.lifecycle.read(scope);
      if (state.pendingPromotion === undefined) {
        return { conflict: true as const };
      }
      const decisions = await ports.decisions.listForScope(scope);
      const readiness = computeReadiness(decisions, asOf);
      const step = stepLifecycle({
        ids: scope,
        state,
        readiness,
        signals: { manual: { kind: 'APPROVE', approver, at: asOf } },
        policy: DEFAULT_GOVERNANCE_POLICY,
        asOf,
      });
      for (const t of step.transitions) await ports.transitions.append(t);
      await ports.lifecycle.write(scope, step.state);
      return {
        effectiveMode: step.effectiveMode,
        transitions: [...step.transitions],
        score: readiness,
      };
    });

    if ('conflict' in result) {
      return reply.code(409).send({ error: 'no pending promotion to approve' });
    }
    return reply.send(result);
  });

  // ── Free-set mode (MANUAL_OVERRIDE) — an Owner/Approver sets the mode directly ────────
  // free_set_mode (OWNER/APPROVER); machine keys blocked (no internal context). Sets effectiveMode
  // to any operating band IMMEDIATELY — no score gate, no approval — as a first-class audited
  // Transition with actor + reason. The earned score is NEVER touched. Subsequent recomputes still
  // auto-demote on a new adverse event (the override is a standing divergence, not a safety switch).
  app.post('/agents/:agentKey/tasks/:taskKey/mode', async (req, reply) => {
    const auth = await requireInternalPermission(req, reply, 'free_set_mode');
    if (auth === null) return;
    const { agentKey, taskKey } = req.params as { agentKey: string; taskKey: string };
    const { mode, reason } = (req.body ?? {}) as { mode?: string; reason?: string };
    // actor = the human identity the web already forwards (approver), else the stable subject.
    const actor = auth.ctx.approver ?? auth.ctx.subject;
    if (actor === undefined || actor.length === 0) {
      return reply.code(400).send({ error: 'actor (approver/subject) required' });
    }
    if (typeof reason !== 'string' || reason.trim().length === 0) {
      return reply.code(400).send({ error: 'reason required' });
    }
    if (mode !== 'SHADOW' && mode !== 'CO_PILOT' && mode !== 'SOLO') {
      return reply.code(400).send({ error: 'mode must be SHADOW | CO_PILOT | SOLO' });
    }
    const orgId = auth.ctx.orgId;
    const asOf = new Date().toISOString();
    const result = await withTenant(orgId, async (tx) => {
      const scope: TaskScope = { orgId, agentKey: agentKey as AgentKey, taskKey: taskKey as TaskKey };
      const current = await taskRepo.findEffectiveMode(tx, orgId, scope.agentKey, scope.taskKey);
      if (current === null) return { notFound: true as const };
      if (current === 'SUSPENDED' || current === 'RETIRED') return { blocked: current };
      const ports = makeRecomputePorts(tx);
      const state = await ports.lifecycle.read(scope);
      // Earned score is NOT recomputed here — override sets effectiveMode only.
      const step = manualOverride({ ids: scope, state, target: mode, actor, reason: reason.trim(), asOf });
      for (const t of step.transitions) await ports.transitions.append(t);
      await ports.lifecycle.write(scope, step.state);
      return { effectiveMode: step.effectiveMode, transitions: [...step.transitions] };
    });
    if ('notFound' in result) return reply.code(404).send({ error: 'unknown agent×task' });
    if ('blocked' in result) {
      return reply
        .code(409)
        .send({ error: `cannot free-set from ${result.blocked} — recovery is the suspend_agent follow-on` });
    }
    return reply.send(result);
  });

  // ── RBAC: the caller's own role (Phase B) ────────────────────────────────────
  // Internal-only, EXEMPT from permission checks: any authenticated internal request may ask
  // "what is my role?" and gets role-or-null. This is also where a pending invite binds to the
  // provider subject on first login — but ONLY when the web forwards a provider-VERIFIED email
  // (x-provable-email-verified: true). Clerk/local emails are verified by construction; OIDC
  // must assert email_verified. An unverified email can never claim an invite.
  app.get('/me', async (req, reply) => {
    const internal = resolveInternal(headersOf(req));
    if (internal === null) return reply.code(401).send({ error: 'internal auth required' });
    const subject = internal.subject;
    if (subject === undefined || subject.length === 0) return reply.send({ role: null });
    const h = headersOf(req);
    const email = typeof h['x-provable-email'] === 'string' ? (h['x-provable-email'] as string) : null;
    const emailVerified = h['x-provable-email-verified'] === 'true';
    const role = await withTenant(internal.orgId, (tx) =>
      membershipRepo.resolveOrBind(tx, internal.orgId, subject, email, emailVerified),
    );
    return reply.send({ role });
  });

  // ── RBAC: people management (manage_people = OWNER) ──────────────────────────
  app.get('/org/members', async (req, reply) => {
    const auth = await requireInternalPermission(req, reply, 'manage_people');
    if (auth === null) return;
    const members = await withTenant(auth.ctx.orgId, (tx) => membershipRepo.list(tx, auth.ctx.orgId));
    return reply.send({ members });
  });

  app.post('/org/members', async (req, reply) => {
    const auth = await requireInternalPermission(req, reply, 'manage_people');
    if (auth === null) return;
    const { email, role } = (req.body ?? {}) as { email?: string; role?: string };
    if (typeof email !== 'string' || email.length === 0) {
      return reply.code(400).send({ error: 'email required' });
    }
    if (!isRole(role)) return reply.code(400).send({ error: 'valid role required', roles: ROLES });
    await withTenant(auth.ctx.orgId, (tx) =>
      membershipRepo.invite(tx, auth.ctx.orgId, email, role, auth.ctx.subject ?? 'unknown'),
    );
    return reply.send({ ok: true });
  });

  app.patch('/org/members/:email', async (req, reply) => {
    const auth = await requireInternalPermission(req, reply, 'manage_people');
    if (auth === null) return;
    const { email } = req.params as { email: string };
    const { role } = (req.body ?? {}) as { role?: string };
    if (!isRole(role)) return reply.code(400).send({ error: 'valid role required', roles: ROLES });
    const orgId = auth.ctx.orgId;
    const result = await withTenant(orgId, async (tx) => {
      const existing = await membershipRepo.getByEmail(tx, orgId, email);
      if (existing === null) return { notFound: true as const };
      // Last-Owner guard: never demote the final OWNER.
      if (existing.role === 'OWNER' && role !== 'OWNER') {
        const owners = await membershipRepo.countOwners(tx, orgId);
        if (owners <= 1) return { lastOwner: true as const };
      }
      await membershipRepo.setRole(tx, orgId, email, role);
      return { ok: true as const };
    });
    if ('notFound' in result) return reply.code(404).send({ error: 'no such member' });
    if ('lastOwner' in result) return reply.code(409).send({ error: 'cannot demote the last owner' });
    return reply.send({ ok: true });
  });

  app.delete('/org/members/:email', async (req, reply) => {
    const auth = await requireInternalPermission(req, reply, 'manage_people');
    if (auth === null) return;
    const { email } = req.params as { email: string };
    const orgId = auth.ctx.orgId;
    const result = await withTenant(orgId, async (tx) => {
      const existing = await membershipRepo.getByEmail(tx, orgId, email);
      if (existing === null) return { notFound: true as const };
      // Last-Owner guard: never remove the final OWNER.
      if (existing.role === 'OWNER') {
        const owners = await membershipRepo.countOwners(tx, orgId);
        if (owners <= 1) return { lastOwner: true as const };
      }
      await membershipRepo.remove(tx, orgId, email);
      return { ok: true as const };
    });
    if ('notFound' in result) return reply.code(404).send({ error: 'no such member' });
    if ('lastOwner' in result) return reply.code(409).send({ error: 'cannot remove the last owner' });
    return reply.send({ ok: true });
  });

  // ── Phase C1: admin agent management (identity machine + keys) ───────────────
  // Agent IDENTITY only — never the autonomy machine. Each route is permission-gated exactly
  // like Phase B; machine keys can't reach any of these (no internal context → 401).

  /** Admin agent list: stored + displayed identity state + the Idle/Deactivated label. */
  app.get('/admin/agents', async (req, reply) => {
    const auth = await requireInternalPermission(req, reply, 'manage_agents');
    if (auth === null) return;
    const asOf = new Date().toISOString();
    const view = await withTenant(auth.ctx.orgId, (tx) => readModelRepo.registry(tx));
    const agents = view.agents.map((a) => ({
      agentKey: a.agentKey,
      displayName: a.displayName,
      identityState: deriveIdentityState(a, asOf),
      displayStatus: deriveDisplayStatus(a, asOf),
      lastSeen: a.lastSeen,
    }));
    return reply.send({ agents, policy: IDENTITY_POLICY });
  });

  /** Provision (pre-register) an agent. Coexists with self-register: the SDK's first call on
   *  this agentKey simply activates the existing DISCOVERED row. 409 if it already exists. */
  app.post('/admin/agents', async (req, reply) => {
    const auth = await requireInternalPermission(req, reply, 'manage_agents');
    if (auth === null) return;
    const { agentKey, displayName } = (req.body ?? {}) as { agentKey?: string; displayName?: string };
    if (typeof agentKey !== 'string' || agentKey.length === 0) {
      return reply.code(400).send({ error: 'agentKey required' });
    }
    const orgId = auth.ctx.orgId;
    const result = await withTenant(orgId, async (tx) => {
      if ((await agentRepo.find(tx, orgId, agentKey as AgentKey)) !== null) {
        return { conflict: true as const };
      }
      await agentRepo.ensure(tx, orgId, agentKey as AgentKey); // DISCOVERED until first contact
      if (typeof displayName === 'string' && displayName.length > 0) {
        await agentRepo.setDisplayName(tx, orgId, agentKey as AgentKey, displayName);
      }
      return { ok: true as const };
    });
    if ('conflict' in result) return reply.code(409).send({ error: 'agent already exists' });
    return reply.send({ ok: true, agentKey, identityState: 'DISCOVERED' });
  });

  /** Rename = set displayName (agentKey is immutable — never renamed). */
  app.patch('/admin/agents/:agentKey', async (req, reply) => {
    const auth = await requireInternalPermission(req, reply, 'manage_agents');
    if (auth === null) return;
    const { agentKey } = req.params as { agentKey: string };
    const { displayName } = (req.body ?? {}) as { displayName?: string };
    if (typeof displayName !== 'string' || displayName.length === 0) {
      return reply.code(400).send({ error: 'displayName required' });
    }
    const orgId = auth.ctx.orgId;
    const ok = await withTenant(orgId, async (tx) => {
      if ((await agentRepo.find(tx, orgId, agentKey as AgentKey)) === null) return false;
      await agentRepo.setDisplayName(tx, orgId, agentKey as AgentKey, displayName);
      return true;
    });
    if (!ok) return reply.code(404).send({ error: 'no such agent' });
    return reply.send({ ok: true, agentKey, displayName });
  });

  // Identity transitions through core's pure machine — no new states, no autonomy touch.
  const identityAction = (
    path: string,
    permission: Permission,
    event: IdentityEvent,
  ): void => {
    app.post(`/admin/agents/:agentKey/${path}`, async (req, reply) => {
      const auth = await requireInternalPermission(req, reply, permission);
      if (auth === null) return;
      const { agentKey } = req.params as { agentKey: string };
      const orgId = auth.ctx.orgId;
      const result = await withTenant(orgId, async (tx) => {
        const agent = await agentRepo.find(tx, orgId, agentKey as AgentKey);
        if (agent === null) return { notFound: true as const };
        const next: AgentIdentityState = transitionIdentity(agent.identityState, event);
        if (next !== agent.identityState) {
          await agentRepo.setIdentityState(tx, orgId, agentKey as AgentKey, next);
        }
        return { identityState: next };
      });
      if ('notFound' in result) return reply.code(404).send({ error: 'no such agent' });
      return reply.send({ ok: true, agentKey, identityState: result.identityState });
    });
  };
  identityAction('deactivate', 'activate_deactivate', 'INACTIVITY'); // ACTIVE → DORMANT
  identityAction('reactivate', 'activate_deactivate', 'ACTIVITY'); //  DORMANT/DISCOVERED → ACTIVE
  identityAction('retire', 'manage_agents', 'RETIRE'); //               → RETIRED (terminal)

  // ── Phase C1: org-scoped key management (mint / rotate / revoke) — manage_keys ──
  app.get('/admin/keys', async (req, reply) => {
    const auth = await requireInternalPermission(req, reply, 'manage_keys');
    if (auth === null) return;
    const keys = await withTenant(auth.ctx.orgId, (tx) => apiKeyRepo.listActive(tx, auth.ctx.orgId));
    return reply.send({
      keys: keys.map((k) => ({
        prefix: k.prefix,
        label: k.label,
        kind: k.kind,
        agentKey: k.agentKey,
        taskKey: k.taskKey,
        createdAt: k.createdAt,
      })),
    });
  });

  app.post('/admin/keys', async (req, reply) => {
    const auth = await requireInternalPermission(req, reply, 'manage_keys');
    if (auth === null) return;
    const { label } = (req.body ?? {}) as { label?: string };
    const k = generateApiKey();
    await withTenant(auth.ctx.orgId, (tx) =>
      apiKeyRepo.mint(tx, auth.ctx.orgId, k.prefix, k.hash, typeof label === 'string' ? label : undefined),
    );
    return reply.send({ key: k.key, prefix: k.prefix }); // shown ONCE
  });

  /** Mint a per-agent Tier-1 GATEWAY key (Phase O2). Distinct kind; bound to agentKey + taskKey. */
  app.post('/admin/keys/gateway', async (req, reply) => {
    const auth = await requireInternalPermission(req, reply, 'manage_keys');
    if (auth === null) return;
    const { agentKey, taskKey, label } = (req.body ?? {}) as {
      agentKey?: string;
      taskKey?: string;
      label?: string;
    };
    if (typeof agentKey !== 'string' || agentKey.length === 0 || typeof taskKey !== 'string' || taskKey.length === 0) {
      return reply.code(400).send({ error: 'agentKey and taskKey are required' });
    }
    const k = generateApiKey();
    await withTenant(auth.ctx.orgId, (tx) =>
      apiKeyRepo.mintGateway(
        tx,
        auth.ctx.orgId,
        agentKey,
        taskKey,
        k.prefix,
        k.hash,
        typeof label === 'string' ? label : 'gateway',
      ),
    );
    return reply.send({ key: k.key, prefix: k.prefix, agentKey, taskKey }); // shown ONCE
  });

  /** Rotate a specific key: mint a new one, revoke the old. Zero-downtime (new valid first). */
  app.post('/admin/keys/:prefix/rotate', async (req, reply) => {
    const auth = await requireInternalPermission(req, reply, 'manage_keys');
    if (auth === null) return;
    const { prefix } = req.params as { prefix: string };
    const orgId = auth.ctx.orgId;
    const k = generateApiKey();
    const result = await withTenant(orgId, async (tx) => {
      await apiKeyRepo.mint(tx, orgId, k.prefix, k.hash, 'rotated');
      const revoked = await apiKeyRepo.revoke(tx, orgId, prefix);
      return { revoked };
    });
    if (result.revoked === 0) return reply.code(404).send({ error: 'no active key with that prefix' });
    return reply.send({ key: k.key, prefix: k.prefix }); // shown ONCE; old key now dead
  });

  app.delete('/admin/keys/:prefix', async (req, reply) => {
    const auth = await requireInternalPermission(req, reply, 'manage_keys');
    if (auth === null) return;
    const { prefix } = req.params as { prefix: string };
    const revoked = await withTenant(auth.ctx.orgId, (tx) => apiKeyRepo.revoke(tx, auth.ctx.orgId, prefix));
    if (revoked === 0) return reply.code(404).send({ error: 'no active key with that prefix' });
    return reply.send({ ok: true });
  });

  return app;
}

/** Narrow an arbitrary string to a valid Role (deny-by-default for unknown values). */
function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
