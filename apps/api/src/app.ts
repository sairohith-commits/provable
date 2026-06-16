import type { AgentKey, OrgId, TaskKey } from '@provable/contracts';
import { DEFAULT_GOVERNANCE_POLICY, computeReadiness, stepLifecycle } from '@provable/core';
import type { TaskScope } from '@provable/core';
import {
  agentRepo,
  makeRecomputePorts,
  resolveOrgByClerkOrgId,
  scoreRepo,
  taskRepo,
  transitionRepo,
  withTenant,
} from '@provable/persistence';
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

  /** Machine-key only (ingestion: /register, /track). Internal token is NOT honored here. */
  async function requireMachineOrg(req: FastifyRequest, reply: FastifyReply): Promise<OrgId | null> {
    const orgId = await authenticate(extractKey(headersOf(req)));
    if (orgId === null) {
      await reply.code(401).send({ error: 'unauthorized' });
      return null;
    }
    return orgId;
  }

  /** Reads: internal (web, Clerk-derived org) OR machine-key. */
  async function requireReadOrg(req: FastifyRequest, reply: FastifyReply): Promise<OrgId | null> {
    const internal = resolveInternal(headersOf(req));
    if (internal !== null) return internal.orgId;
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
    // INTERNAL ONLY: a machine key cannot reach this — that is the moat-integrity flip.
    const internal = resolveInternal(headersOf(req));
    if (internal === null) {
      return reply.code(401).send({ error: 'internal auth required' });
    }
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

  return app;
}
