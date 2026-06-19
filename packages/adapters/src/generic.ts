import { OUTCOMES, type Outcome, type Verdict, VERDICT_KINDS, type VerdictKind } from '@provable/contracts';
import { z } from 'zod';
import type { Connector, MappedDecision, MappedEvent } from './port.js';

/**
 * A generic event/webhook connector with a DECLARATIVE field mapping: the agent's existing
 * structured output is delivered here and mapped (source field → canonical Decision field) with
 * no agent code. The mapping is the first-class, testable surface. Code-defined in C3; the
 * framework is shaped so stored/editable mappings are an additive future change.
 */

export interface ValueMapping<T> {
  /** dotted source path, e.g. "result.verdict" */
  readonly path: string;
  /** source value (lowercased) → canonical kind; unknown values are DROPPED (→ Observe-only). */
  readonly values: Readonly<Record<string, T>>;
}

export interface DeclarativeMapping {
  readonly agentKey: string; // dotted path → agentKey (required field)
  readonly taskKey: string; // dotted path → taskKey (required)
  readonly externalRef: string; // dotted path → externalRef (REQUIRED; missing ⇒ reject)
  readonly at?: string; // dotted path → ISO timestamp
  readonly action?: string; // dotted path → opaque action; default: the whole item
  readonly confidence?: string; // dotted path → 0..1
  readonly verdict?: ValueMapping<VerdictKind>;
  readonly outcome?: ValueMapping<Outcome>;
}

/** Default mapping for a generic event shape. Override per-deployment via CONNECTOR_MAPPING. */
export const DEFAULT_EVENT_MAPPING: DeclarativeMapping = {
  agentKey: 'agent',
  taskKey: 'task',
  externalRef: 'id',
  at: 'timestamp',
  action: 'input',
  confidence: 'confidence',
  verdict: {
    path: 'verdict',
    values: { approved: 'ACCEPTED', accepted: 'ACCEPTED', overridden: 'OVERRIDDEN', escalated: 'ESCALATED', failed: 'FAILED' },
  },
  outcome: {
    path: 'outcome',
    values: { success: 'SUCCESS', partial: 'PARTIAL', failure: 'FAILURE' },
  },
};

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (acc, k) => (acc !== null && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined),
    obj,
  );
}

// Validates the REQUIRED resolved fields. externalRef.min(1) is what REJECTS a source event that
// lacks a stable id — we never ingest-without-dedup on a redelivery-prone path.
const requiredSchema = z.object({
  agentKey: z.string().min(1, 'agentKey is required'),
  taskKey: z.string().min(1, 'taskKey is required'),
  externalRef: z.string().min(1, 'externalRef (a stable source id) is required'),
  confidence: z.number().min(0).max(1).optional(),
  at: z.string().min(1).optional(),
});

function mapValue<T>(item: unknown, m: ValueMapping<T> | undefined): T | undefined {
  if (m === undefined) return undefined;
  const raw = getPath(item, m.path);
  if (typeof raw !== 'string') return undefined; // absent/non-string ⇒ Observe-only
  return m.values[raw.toLowerCase()]; // unknown value ⇒ undefined ⇒ Observe-only
}

function mapItem(item: unknown, mapping: DeclarativeMapping, index: number): MappedEvent {
  if (item === null || typeof item !== 'object') {
    throw new Error(`connector: event[${index}] is not an object`);
  }
  const confidenceRaw = mapping.confidence !== undefined ? getPath(item, mapping.confidence) : undefined;
  const atRaw = mapping.at !== undefined ? getPath(item, mapping.at) : undefined;

  // Throws (reject) when a required field — notably externalRef — is missing/empty.
  const required = requiredSchema.parse({
    agentKey: getPath(item, mapping.agentKey),
    taskKey: getPath(item, mapping.taskKey),
    externalRef: getPath(item, mapping.externalRef),
    ...(typeof confidenceRaw === 'number' ? { confidence: confidenceRaw } : {}),
    ...(typeof atRaw === 'string' ? { at: atRaw } : {}),
  });

  const verdictKind = mapValue(item, mapping.verdict);
  const verdict: Verdict | undefined = verdictKind !== undefined ? { kind: verdictKind } : undefined;
  const outcome = mapValue(item, mapping.outcome);
  const action = mapping.action !== undefined ? getPath(item, mapping.action) : item;

  const decision: MappedDecision = {
    type: 'decision',
    agentKey: required.agentKey,
    taskKey: required.taskKey,
    action: action ?? null,
    source: 'connector',
    externalRef: required.externalRef,
    ...(required.at !== undefined ? { at: required.at } : {}),
    ...(required.confidence !== undefined ? { confidence: required.confidence } : {}),
    ...(verdict !== undefined ? { verdict } : {}),
    ...(outcome !== undefined ? { outcome } : {}),
  };
  return decision;
}

/** Build a connector from a declarative mapping. Accepts a single event or an array. */
export function genericConnector(id: string, mapping: DeclarativeMapping = DEFAULT_EVENT_MAPPING): Connector {
  return {
    id,
    map(payload: unknown): MappedEvent[] {
      const items = Array.isArray(payload) ? payload : [payload];
      return items.map((item, i) => mapItem(item, mapping, i));
    },
  };
}

/** The reference connector shipped in C3. */
export const eventsConnector: Connector = genericConnector('events', DEFAULT_EVENT_MAPPING);

/**
 * PURE mapping engine (Phase O3a) — apply a stored declarative mapping to ONE raw source record
 * and produce a canonical MappedEvent (NO orgId; the composition root stamps the tenant). A record
 * missing the verdict OR outcome path maps to an observe-only decision (no fabricated readiness).
 * Throws on an invalid record (e.g. missing the required externalRef).
 */
export function applyMapping(mapping: DeclarativeMapping, record: unknown): MappedEvent {
  return mapItem(record, mapping, 0);
}

// Zod schema for a STORED mapping (the connector_config.mapping JSON column). Values are validated
// against the canonical enums so a malformed stored mapping is rejected at load, never silently
// mis-translated. The verdict/outcome blocks are optional → those records ingest observe-only.
const valueMapSchema = <T extends string>(members: readonly T[]) =>
  z.object({
    path: z.string().min(1),
    values: z.record(z.string(), z.enum(members as unknown as [T, ...T[]])),
  });

const mappingSchema = z.object({
  agentKey: z.string().min(1),
  taskKey: z.string().min(1),
  externalRef: z.string().min(1),
  at: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  confidence: z.string().min(1).optional(),
  verdict: valueMapSchema(VERDICT_KINDS).optional(),
  outcome: valueMapSchema(OUTCOMES).optional(),
});

/** Validate + parse a stored mapping (JSON column / API input) into a typed DeclarativeMapping. */
export function parseMapping(raw: unknown): DeclarativeMapping {
  return mappingSchema.parse(raw) as DeclarativeMapping;
}
