import { type Role, ROLES, can } from '@provable/contracts';
import { revalidatePath } from 'next/cache';
import { inviteMember, listMembers, removeMember, setMemberRole } from '@/lib/api';
import { getAuthContext } from '@/lib/auth';

// Owner-only people management (Phase B in-app assignment). The API enforces manage_people on
// every call; the page additionally gates the UI. role assignment is by email — the invite
// binds to the provider subject on the invitee's first verified login.
export const dynamic = 'force-dynamic';

function isRole(v: string): v is Role {
  return (ROLES as readonly string[]).includes(v);
}

async function inviteAction(formData: FormData): Promise<void> {
  'use server';
  const ctx = await getAuthContext();
  if (ctx === null || !can(ctx.role, 'manage_people')) return;
  const email = String(formData.get('email') ?? '').trim();
  const role = String(formData.get('role') ?? '');
  if (email.length === 0 || !isRole(role)) return;
  await inviteMember(ctx.orgId, ctx.userId, email, role);
  revalidatePath('/people');
}

async function setRoleAction(formData: FormData): Promise<void> {
  'use server';
  const ctx = await getAuthContext();
  if (ctx === null || !can(ctx.role, 'manage_people')) return;
  const email = String(formData.get('email') ?? '');
  const role = String(formData.get('role') ?? '');
  if (!isRole(role)) return;
  await setMemberRole(ctx.orgId, ctx.userId, email, role);
  revalidatePath('/people');
}

async function removeAction(formData: FormData): Promise<void> {
  'use server';
  const ctx = await getAuthContext();
  if (ctx === null || !can(ctx.role, 'manage_people')) return;
  const email = String(formData.get('email') ?? '');
  await removeMember(ctx.orgId, ctx.userId, email);
  revalidatePath('/people');
}

export default async function PeoplePage() {
  const ctx = await getAuthContext();
  if (ctx === null) {
    return <div className="empty card glass">Sign in to manage people.</div>;
  }
  if (!can(ctx.role, 'manage_people')) {
    return <div className="empty card glass">Only an Owner can manage people.</div>;
  }

  const members = await listMembers(ctx.orgId, ctx.userId);

  return (
    <div className="people">
      <section className="pillar">
        <h2>People &amp; roles</h2>
        <form action={inviteAction} className="invite-form glass">
          <input name="email" type="email" placeholder="person@example.com" required />
          <select name="role" defaultValue="VIEWER">
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button type="submit" className="approve">
            Invite
          </button>
        </form>

        <ul className="member-list" data-member-list>
          {members.map((m) => (
            <li key={m.email} className="member-row glass" data-member={m.email}>
              <span className="member-email">{m.email}</span>
              <span className="member-status">{m.subject === null ? 'invited' : 'active'}</span>
              <form action={setRoleAction} className="member-role-form">
                <input type="hidden" name="email" value={m.email} />
                <select name="role" defaultValue={m.role}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <button type="submit" className="lens">
                  Update
                </button>
              </form>
              <form action={removeAction} className="member-remove-form">
                <input type="hidden" name="email" value={m.email} />
                <button type="submit" className="lens">
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
