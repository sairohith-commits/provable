# Provable — Phase 8 deploy runbook (Vercel + Render + Neon, dev Clerk)

Ship the current build to a shareable pitch URL. **web → Vercel · api → Render · db → Neon ·
auth → the existing dev Clerk instance** (pk_test/sk_test) pointed at the Vercel domain.
No prod Clerk, no billing, no gateway, no feature changes.

Config artifacts in the repo: [`vercel.json`](vercel.json), [`render.yaml`](render.yaml),
[`scripts/neon-bootstrap.sql`](scripts/neon-bootstrap.sql).

> **Who runs what:** Claude Code prepared this and verified the prod builds + the full
> migration chain on a fresh local DB. **Rohith runs every step below** (cloud accounts, env,
> deploys, prod migrate + seed). Steps are ordered because **web depends on the api URL**.

---

## Architecture invariant that drives the env (read first)
The app connects to Postgres as **`provable_app`** — a *non-owner, no-BYPASSRLS* role, so
RLS isolates every tenant. Migrations + the cross-tenant `SECURITY DEFINER` auth lookups run
as the **owner** (`neondb_owner`). Therefore the api needs **two** connection strings:

| var | role | endpoint | used for |
|---|---|---|---|
| `DATABASE_URL` | `provable_app` | pooled or direct | the app runtime (RLS-scoped) |
| `DIRECT_URL` | `neondb_owner` | **direct (non-pooled)** | `prisma migrate deploy` + SECURITY DEFINER ownership |

> ⚠️ The original Phase-8 brief listed only `DATABASE_URL` for Render. That is **insufficient**:
> if the app used the owner connection, RLS would not isolate tenants (the gate would fail);
> if migrations used `provable_app`, they'd lack DDL privileges. Both URLs are required.
> Neon's `FORCE ROW LEVEL SECURITY` was relaxed to `ENABLE` for exactly this reason (see
> "Neon adaptations" at the bottom) — the owner must bypass RLS for auth to work without a
> superuser, while `provable_app` stays fully scoped.

---

## ENV MANIFEST — exactly what goes where

### Vercel (web) — NO `DATABASE_URL`, no api key reaches the browser
| var | value |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | dev Clerk `pk_test_…` |
| `CLERK_SECRET_KEY` | dev Clerk `sk_test_…` |
| `PROVABLE_INTERNAL_TOKEN` | the fresh prod token (SAME as Render) |
| `PROVABLE_API_URL` | the Render api URL, e.g. `https://provable-api.onrender.com` |

### Render (api)
| var | value |
|---|---|
| `DATABASE_URL` | Neon `provable_app` connection string |
| `DIRECT_URL` | Neon `neondb_owner` **direct (non-pooled)** connection string |
| `PROVABLE_INTERNAL_TOKEN` | the fresh prod token (SAME as Vercel) |

(The api makes **no** Anthropic calls — agents do — so it needs **no** Anthropic key. Render
injects `PORT`; `server.ts` already binds `process.env.PORT` on `0.0.0.0`.)

**Generate the shared internal token** (Rohith, run once, paste into BOTH platforms):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## ORDERED RUNBOOK (Rohith executes)

### a. Neon — create the DB + the app role
1. Create a Neon project/database. Capture two strings: the **DIRECT (non-pooled)** owner
   URL (→ `DIRECT_URL`) and note the DB name.
2. Create the RLS-scoped app role **before any migration**: open the Neon SQL editor (or
   `psql` the DIRECT URL) and run [`scripts/neon-bootstrap.sql`](scripts/neon-bootstrap.sql)
   after replacing `REPLACE_WITH_STRONG_PASSWORD` and the DB name. Build the `provable_app`
   connection string with that password → `DATABASE_URL`.

### b. Render — deploy the api (capture its URL)
3. New **Blueprint** from the repo (uses `render.yaml`), or a Node web service with
   build `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @provable/api... build`
   and start `pnpm exec prisma migrate deploy --schema packages/persistence/prisma/schema.prisma && node apps/api/dist/server.js`.
4. Set `DATABASE_URL`, `DIRECT_URL`, `PROVABLE_INTERNAL_TOKEN`. Deploy.
5. Confirm in logs: **all 9 migrations applied** (incl. `…_neon_compat_no_force_rls` and
   `…_add_signal_loss_trigger`) and **`/health` is green**. Capture the api URL.
   - Quick check: `curl https://<render-url>/health` → `{"status":"ok"}`.

### c. Vercel — deploy the web (needs the api URL)
6. Import the repo. **Root Directory = repo root** (so the pnpm workspace resolves);
   `vercel.json` supplies install/build/output. web does **not** run `prisma generate`.
7. Set the 4 web env vars (above), with `PROVABLE_API_URL` = the Render URL and the SAME
   `PROVABLE_INTERNAL_TOKEN`. Deploy. Capture the Vercel domain.

### d. Clerk — allow the Vercel domain
8. In the **dev** Clerk instance, add the Vercel domain to allowed origins / paths (a dev
   banner is fine). No prod Clerk.

### e. Seed prod (synthetic — no Anthropic key)
9. Provision an org against the **prod** DB and link the Clerk org:
   ```bash
   # Rohith — against prod URLs:
   DATABASE_URL=<provable_app url> DIRECT_URL=<neondb_owner direct url> \
     node scripts/provision-org.mjs org_support        # capture the printed key
   DATABASE_URL=<provable_app url> DIRECT_URL=<neondb_owner direct url> \
     node scripts/link-clerk-org.mjs org_support <clerkOrgId>
   ```
10. Point the support agent at the Render api and drive the synthetic showcase:
    ```bash
    # in provable-support-agent/.env:
    #   PROVABLE_BASE_URL=https://<render-url>
    #   PROVABLE_API_KEY=<the key from step 9>
    python -m support_agent warmup    --source synthetic
    python -m support_agent live-climb --source synthetic
    # then the safety events (guardrail trip + signal-loss demotion):
    node scripts/seed-7b.mjs https://<render-url> <key> <PROVABLE_INTERNAL_TOKEN> org_support
    ```

### f. Verify on the live URL
11. Open the Vercel URL → sign in (dev Clerk) → activate the org → the board renders REAL
    data (KPI row, readiness ladders, governance feed, guardrails, registry).
12. Walk the live-crossing: a classify promotion is `PENDING_APPROVAL` → click **Approve** →
    it `APPLIED` with your name in the trail.
13. **RLS isolation on Neon:** provision a *second* org, sign in as a user whose Clerk org maps
    to it → it sees none of org_support's agents. (Or re-run the two-tenant check from the
    migration-chain verification below against the prod DB.)

---

## Verification already done locally (the gate) ✅
Claude Code proved the riskiest part on a **fresh Postgres owned by a NON-superuser role**
(`neon_owner`), simulating Neon's permission model:
- All **9 migrations apply clean** as a non-superuser owner.
- RLS **ENABLED** on all 7 tables, **7** isolation policies, **not FORCEd** (the adaptation).
- `auth_resolve_org` (SECURITY DEFINER) **returns the org** under the non-superuser owner
  (it returned NULL under the old FORCE chain — the bug this phase fixes).
- **Two-tenant isolation holds** for `provable_app`: each org sees only its rows; an unset
  tenant context sees **0** rows.
- `verdict_event` **immutability** trigger rejects UPDATE/DELETE (even for the owner role).
- `SIGNAL_LOSS` enum value present.
- Filtered prod builds succeed: `pnpm --filter @provable/web build:next` and
  `pnpm --filter @provable/api... build`.

### Neon adaptations made
1. **`provable_app` creation** moved to a documented one-time bootstrap
   (`scripts/neon-bootstrap.sql`) — locally it's created by docker init, which Neon has no
   equivalent for. Must run before the first migrate.
2. **`FORCE ROW LEVEL SECURITY` → `ENABLE`** (migration `20260618000000_neon_compat_no_force_rls`):
   Neon has no superuser, so the table owner can't bypass RLS under FORCE, which broke the
   SECURITY DEFINER auth lookups. ENABLE keeps `provable_app` (non-owner) fully isolated while
   letting the owner-run auth functions work. No real weakening — the app never connects as
   the owner.
3. Migrations run via **`DIRECT_URL`** (Neon non-pooled), per the schema's `directUrl`.
