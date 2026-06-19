/**
 * @provable/adapters — the anti-corruption extension point. Connectors validate external data
 * and map it to canonical mapped events; the composition root stamps the tenant and ingests via
 * the existing recompute path. Imports @provable/contracts ONLY among workspace packages; core
 * never imports this (enforced by dependency-cruiser).
 */
export type { Connector, MappedDecision, MappedEvent, MappedVerdictEvent } from './port.js';
export {
  DEFAULT_EVENT_MAPPING,
  applyMapping,
  eventsConnector,
  genericConnector,
  parseMapping,
  type DeclarativeMapping,
  type ValueMapping,
} from './generic.js';
export {
  ANTHROPIC_BASE_URL,
  ANTHROPIC_MESSAGES_PATH,
  ANTHROPIC_PRICES,
  ANTHROPIC_PRICES_AS_OF,
  EMPTY_GATEWAY_USAGE,
  mapAnthropicGatewayDecision,
  parseMessagesUsage,
  priceUsd,
  reduceSseUsage,
  type GatewayCall,
  type GatewayUsage,
  type ModelPrice,
} from './anthropic-gateway.js';
