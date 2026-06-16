import type { OrgId } from '@provable/contracts';
import { orgRepo } from './repositories.js';
import { withTenant } from './tenant.js';

/**
 * Provision an org with a machine key (prefix + sha256 hash). Out-of-band admin
 * helper (no HTTP endpoint creates orgs in Phase 4). Runs inside withTenant so the
 * RLS WITH CHECK (id = current org) is satisfied.
 */
export function provisionOrg(
  orgId: OrgId,
  apiKeyPrefix: string,
  apiKeyHash: string,
  name?: string,
): Promise<void> {
  return withTenant(orgId, async (tx) => {
    await orgRepo.ensure(tx, orgId, name);
    await orgRepo.setApiKey(tx, orgId, apiKeyPrefix, apiKeyHash);
  });
}
