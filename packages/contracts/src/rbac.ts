/**
 * RBAC — roles + the permission matrix (Phase B). PROVABLE access layer.
 *
 * Pure, zero-dependency: this is the SINGLE shared definition consumed by both the web
 * (UX-only hide/disable of controls) and the API (the authoritative enforcement boundary).
 * Keeping `can()` here means the two can never drift on what a role is allowed to do.
 *
 * Roles: OWNER · APPROVER · OPERATOR · VIEWER.
 */
export const ROLES = ['OWNER', 'APPROVER', 'OPERATOR', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];

/**
 * The closed permission vocabulary. Several permissions are DEFINED here but their actions
 * are built in later phases (free-set mode / suspend / activate-deactivate); enforcement is
 * wired onto existing mutating routes only (approve, key rotate). Defining them now keeps the
 * matrix complete and lets later phases gate by an already-agreed permission.
 */
export const PERMISSIONS = [
  'view', // dashboard / audit / ROI
  'approve_transition', // approve or reject a pending transition
  'free_set_mode', // [action built later] free-set mode / MANUAL_OVERRIDE
  'suspend_agent', // [action built later]
  'activate_deactivate', // [action built later]
  'manage_agents', // provision / rename / retire agents
  'manage_keys', // mint / rotate / revoke machine keys
  'manage_people', // invite + assign roles
  'configure_guardrails', // guardrails / thresholds
  'instance_settings', // instance / billing settings
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * The role → permission matrix (PROVABLE_CORE_ARCHITECTURE governance spec). OWNER holds
 * every permission; the others are explicit subsets. This is the deny-by-default source of
 * truth — a permission absent from a role's list is denied.
 */
const MATRIX: Readonly<Record<Role, readonly Permission[]>> = {
  OWNER: [...PERMISSIONS],
  APPROVER: ['view', 'approve_transition', 'free_set_mode', 'suspend_agent', 'activate_deactivate'],
  OPERATOR: ['view', 'activate_deactivate'],
  VIEWER: ['view'],
};

/** True iff the role is granted the permission. Deny-by-default. */
export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

/** The full permission set for a role (read-only). */
export function permissionsFor(role: Role): readonly Permission[] {
  return MATRIX[role];
}
