import { type Role, can } from '@provable/contracts';

// Role-gated admin nav entries (Phase C1). Pure helper shared by both shells; the pages it
// links to are themselves permission-gated API-side, so this is UX convenience only.
export interface NavLink {
  readonly href: string;
  readonly label: string;
}

export function adminNavLinks(role: Role): NavLink[] {
  const links: NavLink[] = [];
  if (can(role, 'manage_agents') || can(role, 'manage_keys')) {
    links.push({ href: '/onboarding', label: 'Onboarding' });
  }
  if (can(role, 'manage_agents') || can(role, 'activate_deactivate')) {
    links.push({ href: '/admin/agents', label: 'Agents' });
  }
  if (can(role, 'manage_people')) links.push({ href: '/people', label: 'People' });
  return links;
}
