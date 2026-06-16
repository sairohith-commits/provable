import './globals.css';
import {
  ClerkProvider,
  OrganizationSwitcher,
  Show,
  SignInButton,
  UserButton,
} from '@clerk/nextjs';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Provable',
  description: 'Agent governance — readiness, lifecycle, audit.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <header className="chrome glass">
            <div className="brand">
              Provable <span className="brand-sub">governance</span>
            </div>
            <div className="chrome-right">
              <Show when="signed-in">
                <OrganizationSwitcher hidePersonal />
                <UserButton />
              </Show>
              <Show when="signed-out">
                <SignInButton />
              </Show>
            </div>
          </header>
          <main>{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}
