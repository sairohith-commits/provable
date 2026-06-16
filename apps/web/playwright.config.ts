import { defineConfig } from '@playwright/test';

// Live-crossing e2e. Requires Clerk DEV keys + the local Provable API (:3010) + a running
// web dev server. Set CLERK_* + PROVABLE_* in .env.local, then `pnpm -F @provable/web e2e`.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: process.env.WEB_BASE_URL ?? 'http://localhost:3020' },
});
