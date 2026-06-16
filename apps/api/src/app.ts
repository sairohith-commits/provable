import type { AgentKey, OrgId, TaskKey } from '@provable/contracts';
import { agentRepo, scoreRepo, taskRepo, withTenant } from '@provable/persistence';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticate, extractKey } from './auth.js';
import { recompute } from './recompute.js';
import { registerSchema, trackSchema } from './schemas.js';

export interface BuildAppOptions {
  readonly logger?: boolean;
}

export function buildApp(opts?: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: opts?.logger
      ? { redact: ['req.headers.authorization', 'req.headers["x-api-key"]'] }
      : false,
  });

  async function requireOrg(req: FastifyRequest, reply: FastifyReply): Promise<OrgId | null> {
    const orgId = await authenticate(extractKey(req.headers as Record<string, unknown>));
    if (orgId === null) {
      await reply.code(401).send({ error: 'unauthorized' });
      return null;
    }
    return orgId;
  }

  app.post('/register', async (req, reply) => {
    const orgId = await requireOrg(req, reply);
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
    const orgId = await requireOrg(req, reply);
    if (orgId === null) return;
    const parsed = trackSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid payload', issues: parsed.error.issues });
    }
    const result = await recompute(orgId, parsed.data);
    if ('notFound' in result) {
      return reply.code(404).send({ error: 'no decision for externalRef' });
    }
    return reply.send(result);
  });

  app.get('/agents/:agentKey/tasks/:taskKey', async (req, reply) => {
    const orgId = await requireOrg(req, reply);
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
    if (body === null) {
      return reply.code(404).send({ error: 'unknown agent×task' });
    }
    return reply.send(body);
  });

  return app;
}
