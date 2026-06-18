import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Web is a pure HTTP client of the read API; no server DB access.
  reactStrictMode: true,
  // Self-contained server bundle for the BYOC container image (deploy/Dockerfile.web).
  // Additive + Vercel-safe: Vercel ignores this and uses its own build pipeline.
  output: 'standalone',
};

export default nextConfig;
