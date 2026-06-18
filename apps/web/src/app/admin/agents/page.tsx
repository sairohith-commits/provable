import { can } from '@provable/contracts';
import { revalidatePath } from 'next/cache';
import {
  agentIdentityAction,
  listAdminAgents,
  listKeys,
  provisionAgent,
  renameAgent,
} from '@/lib/api';
import { getAuthContext } from '@/lib/auth';
import { AdminKeys } from '@/components/admin-keys';

// Admin agent management (Phase C1) — DISTINCT from the monitoring Overview. Provision, rename,
// deactivate/reactivate, retire + org keys. Every control is gated by can() for UX; the API is
// the authoritative boundary. Reachable only with manage_agents (or activate_deactivate).
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  DISCOVERED: 'Discovered',
  ACTIVE: 'Active',
  IDLE: 'Idle',
  DEACTIVATED: 'Deactivated',
  RETIRED: 'Retired',
};

async function provisionAction(formData: FormData): Promise<void> {
  'use server';
  const ctx = await getAuthContext();
  if (ctx === null || !can(ctx.role, 'manage_agents')) return;
  const agentKey = String(formData.get('agentKey') ?? '').trim();
  const displayName = String(formData.get('displayName') ?? '').trim();
  if (agentKey.length === 0) return;
  await provisionAgent(ctx.orgId, ctx.userId, agentKey, displayName || undefined);
  revalidatePath('/admin/agents');
}

async function renameAction(formData: FormData): Promise<void> {
  'use server';
  const ctx = await getAuthContext();
  if (ctx === null || !can(ctx.role, 'manage_agents')) return;
  const agentKey = String(formData.get('agentKey') ?? '');
  const displayName = String(formData.get('displayName') ?? '').trim();
  if (displayName.length === 0) return;
  await renameAgent(ctx.orgId, ctx.userId, agentKey, displayName);
  revalidatePath('/admin/agents');
}

async function lifecycleAction(formData: FormData): Promise<void> {
  'use server';
  const ctx = await getAuthContext();
  if (ctx === null) return;
  const agentKey = String(formData.get('agentKey') ?? '');
  const action = String(formData.get('action') ?? '') as 'deactivate' | 'reactivate' | 'retire';
  const perm = action === 'retire' ? 'manage_agents' : 'activate_deactivate';
  if (!can(ctx.role, perm)) return;
  if (action !== 'deactivate' && action !== 'reactivate' && action !== 'retire') return;
  await agentIdentityAction(ctx.orgId, ctx.userId, agentKey, action);
  revalidatePath('/admin/agents');
}

export default async function AdminAgentsPage() {
  const ctx = await getAuthContext();
  if (ctx === null) return <div className="empty card glass">Sign in to manage agents.</div>;
  const canAgents = can(ctx.role, 'manage_agents');
  const canActivate = can(ctx.role, 'activate_deactivate');
  const canKeys = can(ctx.role, 'manage_keys');
  if (!canAgents && !canActivate) {
    return <div className="empty card glass">You don’t have access to agent management.</div>;
  }

  const [agents, keys] = await Promise.all([
    listAdminAgents(ctx.orgId, ctx.userId),
    canKeys ? listKeys(ctx.orgId, ctx.userId) : Promise.resolve([]),
  ]);

  return (
    <div className="admin-agents">
      <section className="pillar">
        <h2>Agents</h2>
        {canAgents ? (
          <form action={provisionAction} className="provision-form glass">
            <input name="agentKey" placeholder="agent-key (immutable)" required />
            <input name="displayName" placeholder="display name (optional)" />
            <button type="submit" className="approve">
              Provision
            </button>
          </form>
        ) : null}

        <ul className="agent-admin-list" data-agent-list>
          {agents.map((a) => {
            const terminal = a.displayStatus === 'RETIRED';
            return (
              <li key={a.agentKey} className="agent-admin-row glass" data-agent={a.agentKey} data-status={a.displayStatus}>
                <span className="agent-key">{a.agentKey}</span>
                <span className="agent-name">{a.displayName ?? ''}</span>
                <span className="agent-status" data-status-label>{STATUS_LABEL[a.displayStatus] ?? a.displayStatus}</span>
                {canAgents && !terminal ? (
                  <form action={renameAction} className="inline-form">
                    <input type="hidden" name="agentKey" value={a.agentKey} />
                    <input name="displayName" placeholder="rename" />
                    <button type="submit" className="lens">Rename</button>
                  </form>
                ) : null}
                {canActivate && !terminal ? (
                  <form action={lifecycleAction} className="inline-form">
                    <input type="hidden" name="agentKey" value={a.agentKey} />
                    <input
                      type="hidden"
                      name="action"
                      value={a.displayStatus === 'DEACTIVATED' ? 'reactivate' : 'deactivate'}
                    />
                    <button type="submit" className="lens">
                      {a.displayStatus === 'DEACTIVATED' ? 'Reactivate' : 'Deactivate'}
                    </button>
                  </form>
                ) : null}
                {canAgents && !terminal ? (
                  <form action={lifecycleAction} className="inline-form">
                    <input type="hidden" name="agentKey" value={a.agentKey} />
                    <input type="hidden" name="action" value="retire" />
                    <button type="submit" className="lens">Retire</button>
                  </form>
                ) : null}
              </li>
            );
          })}
          {agents.length === 0 ? <li className="empty">No agents yet.</li> : null}
        </ul>
      </section>

      {canKeys ? <AdminKeys keys={keys} canManage={canKeys} /> : null}
    </div>
  );
}
