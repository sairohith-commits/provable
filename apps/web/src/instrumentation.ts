// Next.js boot hook. Validate the ACTIVE auth provider's config at startup so a
// missing/misconfigured provider fails LOUDLY on boot — never a silent fallback or a
// first-request surprise. Edge-safe (config.ts reads only process.env).
import { assertActiveConfig } from '@/lib/auth/config';

export function register(): void {
  const type = assertActiveConfig();
  // eslint-disable-next-line no-console
  console.log(`[auth] provider=${type} configured.`);
}
