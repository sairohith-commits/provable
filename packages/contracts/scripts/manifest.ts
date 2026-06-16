import {
  AGENT_IDENTITY_STATES,
  AUTONOMY_MODES,
  OUTCOMES,
  SOURCES,
  TRANSITION_DIRECTIONS,
  TRANSITION_STATUSES,
  TRANSITION_TRIGGERS,
  VERDICT_KINDS,
} from '../src/index.js';

/**
 * The cross-language contract manifest: the closed sets, derived from the const
 * arrays (the single source of truth). The committed contract-manifest.json is the
 * ONLY thing sdk-python depends on from the TS side — its Pydantic drift test asserts
 * its enums equal these sets. This builder is shared by the generator and the TS
 * sync test, so they cannot disagree. It lives in scripts/ (not src/) to keep the
 * contracts package's runtime surface to the const arrays + assertNever only.
 */
export interface ContractManifest {
  readonly version: number;
  readonly verdictKinds: string[];
  readonly outcomes: string[];
  readonly sources: string[];
  readonly autonomyModes: string[];
  readonly agentIdentityStates: string[];
  readonly transitionDirections: string[];
  readonly transitionTriggers: string[];
  readonly transitionStatuses: string[];
}

export const MANIFEST_FILENAME = 'contract-manifest.json';

export function buildManifest(): ContractManifest {
  return {
    version: 1,
    verdictKinds: [...VERDICT_KINDS],
    outcomes: [...OUTCOMES],
    sources: [...SOURCES],
    autonomyModes: [...AUTONOMY_MODES],
    agentIdentityStates: [...AGENT_IDENTITY_STATES],
    transitionDirections: [...TRANSITION_DIRECTIONS],
    transitionTriggers: [...TRANSITION_TRIGGERS],
    transitionStatuses: [...TRANSITION_STATUSES],
  };
}

/** Canonical serialization (2-space + trailing newline) so the committed file is stable. */
export function serializeManifest(manifest: ContractManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
