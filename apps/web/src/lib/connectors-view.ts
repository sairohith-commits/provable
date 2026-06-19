// PURE connector-editor view logic (Phase O3b). Node-testable; imports nothing from the engine —
// it only ASSEMBLES the declarative mapping JSON the editor form represents. The real mapping +
// the governed-vs-observe-only verdict come from the backend dry-run (the O3a applyMapping engine);
// this never reimplements that. Web→contracts-only (no @provable/adapters import).

export interface ValueMapRow {
  from: string; // source value, e.g. "approved"
  to: string; // canonical kind, e.g. "ACCEPTED"
}

export interface ConnectorForm {
  name: string;
  agentKey: string;
  taskKey: string;
  externalRef: string;
  confidence: string;
  timestamp: string;
  action: string;
  verdictPath: string;
  verdictMap: ValueMapRow[];
  outcomePath: string;
  outcomeMap: ValueMapRow[];
}

/** A declarative mapping draft — shaped like the adapter's DeclarativeMapping but defined locally
 *  (the API validates it via parseMapping). */
export interface MappingDraft {
  agentKey: string;
  taskKey: string;
  externalRef: string;
  at?: string;
  action?: string;
  confidence?: string;
  verdict?: { path: string; values: Record<string, string> };
  outcome?: { path: string; values: Record<string, string> };
}

export function emptyForm(): ConnectorForm {
  return {
    name: '',
    agentKey: 'agent',
    taskKey: 'task',
    externalRef: 'id',
    confidence: '',
    timestamp: '',
    action: '',
    verdictPath: '',
    verdictMap: [{ from: '', to: '' }],
    outcomePath: '',
    outcomeMap: [{ from: '', to: '' }],
  };
}

/** Collapse value-map rows → a lowercased source-value → canonical-kind record (empty rows dropped). */
export function valuesFromRows(rows: readonly ValueMapRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const from = r.from.trim();
    const to = r.to.trim();
    if (from.length > 0 && to.length > 0) out[from.toLowerCase()] = to;
  }
  return out;
}

/** Build the declarative mapping the editor represents. Optional paths are omitted when empty; a
 *  verdict/outcome block is included ONLY when it has a path AND at least one value-map row. */
export function buildMapping(form: ConnectorForm): MappingDraft {
  const m: MappingDraft = {
    agentKey: form.agentKey.trim(),
    taskKey: form.taskKey.trim(),
    externalRef: form.externalRef.trim(),
  };
  if (form.timestamp.trim().length > 0) m.at = form.timestamp.trim();
  if (form.action.trim().length > 0) m.action = form.action.trim();
  if (form.confidence.trim().length > 0) m.confidence = form.confidence.trim();

  const vValues = valuesFromRows(form.verdictMap);
  if (form.verdictPath.trim().length > 0 && Object.keys(vValues).length > 0) {
    m.verdict = { path: form.verdictPath.trim(), values: vValues };
  }
  const oValues = valuesFromRows(form.outcomeMap);
  if (form.outcomePath.trim().length > 0 && Object.keys(oValues).length > 0) {
    m.outcome = { path: form.outcomePath.trim(), values: oValues };
  }
  return m;
}

/** Whether the required field-paths are present (the minimum a mapping needs to be saveable). */
export function mappingComplete(form: ConnectorForm): boolean {
  return (
    form.name.trim().length > 0 &&
    form.agentKey.trim().length > 0 &&
    form.taskKey.trim().length > 0 &&
    form.externalRef.trim().length > 0
  );
}

/** Parse the pasted sample record JSON. */
export function parseSample(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** The human verdict for the dry-run result — display only; the boolean comes from the backend. */
export function governLabel(governed: boolean): string {
  return governed ? 'This connector will GOVERN (scored)' : 'This connector is OBSERVE-ONLY (no verdict)';
}
