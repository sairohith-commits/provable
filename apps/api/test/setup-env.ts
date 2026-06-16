import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

// Reuse the persistence package's .env (single source of DB credentials).
const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, '..', '..', '..', 'packages', 'persistence', '.env') });
