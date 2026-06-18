import { assertRlsScopedConnection } from '@provable/persistence';
import { buildApp } from './app.js';

// Composition root entrypoint (apps/api is the only place wiring happens).
const app = buildApp({ logger: true });
const port = Number(process.env['PORT'] ?? 3000);

// License is an optional, OFFLINE slot — read + logged, never validated, never phones home.
const licensed = (process.env['LICENSE_KEY'] ?? '').length > 0;
app.log.info(`[license] ${licensed ? 'key present (offline, not validated)' : 'no key (unlicensed mode)'}`);

async function main(): Promise<void> {
  // BYOC hardening: refuse to start if the runtime DB connection can bypass RLS (superuser,
  // BYPASSRLS, or the table owner under ENABLE) — that would silently break tenant isolation.
  try {
    await assertRlsScopedConnection();
  } catch (err) {
    app.log.error({ err }, 'FATAL: runtime DB connection is not RLS-scoped — refusing to start');
    process.exit(1);
  }
  await app.listen({ port, host: '0.0.0.0' });
}

main().catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
