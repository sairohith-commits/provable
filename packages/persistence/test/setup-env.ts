import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

// Runs in every test worker before test files — make DATABASE_URL / DIRECT_URL
// available to PrismaClient constructors.
const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, '..', '.env') });
