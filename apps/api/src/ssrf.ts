import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * SSRF guard for connector PULL (Phase O3a). A pull fetches an operator-supplied URL server-side,
 * so it MUST refuse to reach internal infrastructure: loopback, RFC-1918 private ranges, link-local
 * (incl. the 169.254.169.254 cloud-metadata endpoint), CGNAT, and IPv6 loopback/link-local/ULA.
 * Only public http(s) is allowed. A hostname is resolved and EVERY resolved address is checked, so
 * a public name that resolves to a private IP (DNS rebinding) is still rejected.
 *
 * Operator escape hatch: CONNECTOR_PULL_ALLOW_HOSTS (comma-separated exact hostnames) opts specific
 * hosts back in — for self-hosted internal sources (and the test fixture).
 */
export class SsrfError extends Error {}

function ipv4Blocked(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true; // unparseable → block
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 10) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  return false;
}

function ipv6Blocked(ip: string): boolean {
  const x = ip.toLowerCase();
  if (x === '::1' || x === '::') return true; // loopback / unspecified
  if (x.startsWith('fe80')) return true; // link-local
  if (x.startsWith('fc') || x.startsWith('fd')) return true; // unique-local fc00::/7
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x); // IPv4-mapped
  if (mapped?.[1] !== undefined) return ipv4Blocked(mapped[1]);
  return false;
}

function ipBlocked(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return ipv4Blocked(ip);
  if (v === 6) return ipv6Blocked(ip);
  return true; // not a valid IP → block
}

function allowlist(): Set<string> {
  return new Set(
    (process.env['CONNECTOR_PULL_ALLOW_HOSTS'] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

export async function assertPullUrlAllowed(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError('invalid url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfError('only http(s) URLs are allowed');
  }
  const host = url.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets

  if (allowlist().has(url.hostname) || allowlist().has(host)) return; // explicit operator opt-in

  if (isIP(host) !== 0) {
    if (ipBlocked(host)) throw new SsrfError('blocked address (loopback/private/link-local/metadata)');
    return;
  }

  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new SsrfError('host did not resolve');
  }
  if (addrs.length === 0) throw new SsrfError('host did not resolve');
  for (const a of addrs) {
    if (ipBlocked(a.address)) throw new SsrfError('host resolves to a blocked address');
  }
}
