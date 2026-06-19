'use client';

import type { Role } from '@provable/contracts';
import {
  Activity,
  Boxes,
  Cable,
  DollarSign,
  type LucideIcon,
  KeyRound,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { type IconName, activeKey, navFor } from '@/lib/nav';

const ICONS: Record<IconName, LucideIcon> = {
  overview: LayoutDashboard,
  activity: Activity,
  safety: ShieldAlert,
  cost: DollarSign,
  registry: Boxes,
  connect: Plug,
  connectors: Cable,
  onboarding: KeyRound,
  agents: Boxes,
  people: Users,
};

// Left sidebar rail (Phase U3). PURE LAYOUT — no auth logic; the auth gate stays in the
// untouched getAuthState/<Show> path. Collapses to an icon-rail on narrow widths / toggle.
export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  const active = activeKey(pathname ?? '/');
  const [collapsed, setCollapsed] = useState(false);
  const sections = navFor(role);

  return (
    <nav className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label="primary" data-sidebar>
      <button
        className="sidebar-toggle"
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? 'expand sidebar' : 'collapse sidebar'}
        data-sidebar-toggle
      >
        {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
      </button>
      {sections.map((section) => (
        <div className="sidebar-group" key={section.group}>
          <span className="sidebar-group-label">{section.group}</span>
          <ul>
            {section.items.map((item) => {
              const Icon = ICONS[item.icon];
              const isActive = item.key === active;
              return (
                <li key={item.key}>
                  <a
                    className={`sidebar-link${isActive ? ' active' : ''}`}
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    data-nav={item.key}
                    title={item.label}
                  >
                    <Icon size={17} aria-hidden className="sidebar-icon" />
                    <span className="sidebar-label">{item.label}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
