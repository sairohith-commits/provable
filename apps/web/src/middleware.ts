import { clerkMiddleware } from '@clerk/nextjs/server';
import type { NextMiddleware } from 'next/server';
import { activeProviderType } from '@/lib/auth/config';
import { makeSessionMiddleware } from '@/lib/auth/session-middleware';

// Provider-dispatched edge middleware. AUTH_PROVIDER selects exactly one. This module imports
// only EDGE-SAFE code per provider (clerkMiddleware, or the jose-based session middleware) —
// never openid-client/bcryptjs — so the Edge bundle stays clean. Clerk's branch is the SAME
// clerkMiddleware() as before; the live deploy is unchanged.
function build(): NextMiddleware {
  switch (activeProviderType()) {
    case 'clerk':
      return clerkMiddleware();
    case 'oidc':
      return makeSessionMiddleware('oidc');
    case 'local':
      return makeSessionMiddleware('local');
  }
}

export default build();

export const config = {
  // Run on every app route (so server-side auth always sees the middleware), skipping only
  // Next internals and static files (paths containing a dot). NOTE: the dot must be escaped as
  // `\\.` — a single `\.` is mangled by the JS string literal into `.`, which then matches any
  // char and silently excludes every non-root route (that bug 500'd /connect before this fix).
  matcher: ['/((?!_next|[^?]*\\.[^?]*).*)', '/(api)(.*)'],
};
