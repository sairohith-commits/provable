/**
 * @provable/adapters — the anti-corruption extension point. Connectors validate external data
 * and map it to canonical mapped events; the composition root stamps the tenant and ingests via
 * the existing recompute path. Imports @provable/contracts ONLY among workspace packages; core
 * never imports this (enforced by dependency-cruiser).
 */
export type { Connector, MappedDecision, MappedEvent, MappedVerdictEvent } from './port.js';
export {
  DEFAULT_EVENT_MAPPING,
  eventsConnector,
  genericConnector,
  type DeclarativeMapping,
  type ValueMapping,
} from './generic.js';
