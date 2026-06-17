import { clerkMiddleware } from '@clerk/nextjs/server';

export default clerkMiddleware();

export const config = {
  // Run on every app route (so server-side auth() always sees clerkMiddleware), skipping only
  // Next internals and static files (paths containing a dot). NOTE: the dot must be escaped as
  // `\\.` — a single `\.` is mangled by the JS string literal into `.`, which then matches any
  // char and silently excludes every non-root route (that bug 500'd /connect before this fix).
  matcher: ['/((?!_next|[^?]*\\.[^?]*).*)', '/(api)(.*)'],
};
