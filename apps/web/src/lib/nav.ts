import { type Role, can } from '@provable/contracts';

// Pure sidebar nav model (Phase U3). Node-testable; imports only @provable/contracts. The
// Sidebar renders this verbatim and maps `icon` → a lucide component. Govern items are
// view-level (all roles); Manage items are role-gated (UX only — the API/pages stay authoritative).
export type NavGroup = 'Govern' | 'Manage';
export type IconName =
  | 'overview'
  | 'activity'
  | 'safety'
  | 'cost'
  | 'registry'
  | 'connect'
  | 'connectors'
  | 'onboarding'
  | 'agents'
  | 'people';

export interface NavItem {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly icon: IconName;
  readonly group: NavGroup;
}

interface NavDef extends NavItem {
  readonly perm?: (role: Role) => boolean;
}

const ITEMS: readonly NavDef[] = [
  { key: 'overview', label: 'Overview', href: '/', icon: 'overview', group: 'Govern' },
  { key: 'activity', label: 'Activity', href: '/activity', icon: 'activity', group: 'Govern' },
  { key: 'safety', label: 'Safety', href: '/safety', icon: 'safety', group: 'Govern' },
  { key: 'cost', label: 'Cost & ROI', href: '/cost', icon: 'cost', group: 'Govern' },
  { key: 'registry', label: 'Registry', href: '/registry', icon: 'registry', group: 'Govern' },
  { key: 'connect', label: 'Connect', href: '/connect', icon: 'connect', group: 'Manage' },
  {
    key: 'connectors',
    label: 'Connectors',
    href: '/connectors',
    icon: 'connectors',
    group: 'Manage',
    perm: (r) => can(r, 'manage_agents'),
  },
  {
    key: 'onboarding',
    label: 'Onboarding',
    href: '/onboarding',
    icon: 'onboarding',
    group: 'Manage',
    perm: (r) => can(r, 'manage_agents') || can(r, 'manage_keys'),
  },
  {
    key: 'agents',
    label: 'Agents',
    href: '/admin/agents',
    icon: 'agents',
    group: 'Manage',
    perm: (r) => can(r, 'manage_agents') || can(r, 'activate_deactivate'),
  },
  { key: 'people', label: 'People', href: '/people', icon: 'people', group: 'Manage', perm: (r) => can(r, 'manage_people') },
];

export interface NavSection {
  readonly group: NavGroup;
  readonly items: readonly NavItem[];
}

/** The role-filtered nav, grouped (Govern, then Manage). Empty groups are dropped. */
export function navFor(role: Role): NavSection[] {
  const visible = ITEMS.filter((i) => i.perm === undefined || i.perm(role));
  const groups: NavGroup[] = ['Govern', 'Manage'];
  return groups
    .map((group) => ({ group, items: visible.filter((i) => i.group === group).map(stripPerm) }))
    .filter((s) => s.items.length > 0);
}

function stripPerm(i: NavDef): NavItem {
  return { key: i.key, label: i.label, href: i.href, icon: i.icon, group: i.group };
}

/** The active nav key for a pathname (longest-prefix match; '/' only matches exactly). */
export function activeKey(pathname: string): string {
  let best: NavItem | undefined;
  for (const i of ITEMS) {
    const match = i.href === '/' ? pathname === '/' : pathname === i.href || pathname.startsWith(`${i.href}/`);
    if (match && (best === undefined || i.href.length > best.href.length)) best = i;
  }
  return best?.key ?? 'overview';
}
