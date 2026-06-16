import { OUTCOMES, SOURCES, VERDICT_KINDS } from '@provable/contracts';
import { z } from 'zod';

/**
 * Boundary schemas. The enums are derived directly from the contracts' runtime
 * const arrays, so they cannot drift from the canonical model.
 */
const enumOf = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values as unknown as [string, ...string[]]);

const sourceSchema = enumOf(SOURCES);
const outcomeSchema = enumOf(OUTCOMES);

const verdictSchema = z
  .object({
    kind: enumOf(VERDICT_KINDS),
    magnitude: z.number().min(0).max(1).optional(),
  })
  .refine((v) => v.magnitude === undefined || v.kind === 'OVERRIDDEN', {
    message: 'magnitude is only valid for an OVERRIDDEN verdict',
  });

const costSchema = z.object({
  tokens: z.number().int().nonnegative().optional(),
  usd: z.number().nonnegative().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
});

const signalsSchema = z.object({
  drift: z
    .object({ detectedAt: z.string().optional(), reason: z.string(), magnitude: z.number().optional() })
    .optional(),
  guardrail: z
    .object({ guardrailId: z.string(), trippedAt: z.string().optional(), reason: z.string() })
    .optional(),
  manual: z
    .discriminatedUnion('kind', [
      z.object({
        kind: z.literal('APPROVE'),
        approver: z.string().min(1),
        at: z.string().optional(),
        reason: z.string().optional(),
      }),
      z.object({
        kind: z.literal('REJECT'),
        approver: z.string().min(1),
        at: z.string().optional(),
        reason: z.string().optional(),
      }),
    ])
    .optional(),
});

export const registerSchema = z.object({
  agentKey: z.string().min(1),
  taskKey: z.string().min(1).optional(),
});

const trackDecisionSchema = z.object({
  type: z.literal('decision'),
  agentKey: z.string().min(1),
  taskKey: z.string().min(1),
  at: z.string().optional(),
  action: z.unknown(),
  confidence: z.number().min(0).max(1).optional(),
  cost: costSchema.optional(),
  verdict: verdictSchema.optional(),
  outcome: outcomeSchema.optional(),
  source: sourceSchema,
  externalRef: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  signals: signalsSchema.optional(),
});

const trackVerdictSchema = z.object({
  type: z.literal('verdict'),
  source: sourceSchema,
  externalRef: z.string().min(1),
  verdict: verdictSchema.optional(),
  outcome: outcomeSchema.optional(),
  at: z.string().optional(),
  signals: signalsSchema.optional(),
});

export const trackSchema = z.discriminatedUnion('type', [trackDecisionSchema, trackVerdictSchema]);

export type RegisterBody = z.infer<typeof registerSchema>;
export type TrackBody = z.infer<typeof trackSchema>;
