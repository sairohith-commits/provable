import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Web is a pure HTTP client of the read API; no server DB access.
  reactStrictMode: true,
};

export default nextConfig;
