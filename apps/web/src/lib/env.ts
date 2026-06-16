import 'server-only';

// Server-only configuration. The internal token never reaches the browser.
export const apiUrl = process.env.PROVABLE_API_URL ?? 'http://localhost:3010';

export function internalToken(): string {
  const token = process.env.PROVABLE_INTERNAL_TOKEN;
  if (token === undefined || token.length === 0) {
    throw new Error('PROVABLE_INTERNAL_TOKEN is not set (server-only)');
  }
  return token;
}
