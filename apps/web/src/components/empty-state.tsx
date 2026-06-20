import {
  Activity,
  Boxes,
  Building2,
  DollarSign,
  Inbox,
  type LucideIcon,
  LogIn,
  Plug,
  ShieldAlert,
  ShieldCheck,
  UserX,
} from 'lucide-react';

/**
 * The one shared first-impression surface (Phase 3). Centered, one muted icon, a one-line
 * truthful explainer, and an optional real next-action link. Two variants off the same component:
 *   • 'empty' — authed but nothing to show yet (no data).
 *   • 'gated' — not set up / no access yet.
 * Pure presentation. Callers render it INSIDE PillarShell so the sidebar never drops. Copy is
 * passed in verbatim — this component never fabricates metrics.
 */
export type EmptyIcon =
  | 'agents'
  | 'activity'
  | 'safety'
  | 'safety-clear'
  | 'cost'
  | 'registry'
  | 'transitions'
  | 'connect'
  | 'signin'
  | 'no-org'
  | 'no-access';

const ICONS: Record<EmptyIcon, LucideIcon> = {
  agents: Boxes,
  activity: Activity,
  safety: ShieldAlert,
  'safety-clear': ShieldCheck,
  cost: DollarSign,
  registry: Boxes,
  transitions: Inbox,
  connect: Plug,
  signin: LogIn,
  'no-org': Building2,
  'no-access': UserX,
};

export interface EmptyStateAction {
  readonly href: string;
  readonly label: string;
}

export function EmptyState({
  icon,
  title,
  action,
  variant = 'empty',
  attrs,
}: {
  icon: EmptyIcon;
  title: string;
  action?: EmptyStateAction;
  variant?: 'empty' | 'gated';
  /** Optional passthrough for preserved data-* hooks (e.g. data-readiness-empty). */
  attrs?: Record<string, string>;
}) {
  const Icon = ICONS[icon];
  return (
    <div className="empty-state card glass" data-empty-state={variant} {...attrs}>
      <Icon className="empty-state-icon" size={28} strokeWidth={1.6} aria-hidden />
      <p className="empty-state-title">{title}</p>
      {action ? (
        <a className="empty-state-action" href={action.href}>
          {action.label}
        </a>
      ) : null}
    </div>
  );
}
