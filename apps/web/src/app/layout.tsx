import './globals.css';
import type { ReactNode } from 'react';
import { selectAuthProvider } from '@/lib/auth';

export const metadata = {
  title: 'Provable',
  description: 'Agent governance — readiness, lifecycle, audit.',
};

// The root shell is supplied by the active auth provider (AUTH_PROVIDER). Under Clerk this is
// byte-identical to the previous layout (ClerkProvider + client chrome); oidc/local render an
// equivalent shell with plain sign-in/out links.
export default function RootLayout({ children }: { children: ReactNode }) {
  const AppShell = selectAuthProvider().AppShell;
  return <AppShell>{children}</AppShell>;
}
