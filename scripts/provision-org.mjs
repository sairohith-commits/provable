// Local helper: provision an org with a fresh machine key and print the key to stdout.
// Used by the SDK integration run. Requires DATABASE_URL/DIRECT_URL in the env.
import { generateApiKey } from '../apps/api/dist/index.js';
import { disconnect, provisionOrg } from '../packages/persistence/dist/index.js';

const orgId = process.argv[2] ?? 'org_sdk';
const key = generateApiKey();
await provisionOrg(orgId, key.prefix, key.hash);
await disconnect();
process.stdout.write(key.key);
