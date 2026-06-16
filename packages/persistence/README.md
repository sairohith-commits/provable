# @provable/persistence

Prisma + PostgreSQL tenant data layer with **DB-enforced Row-Level Security**.

## Local dev — one-command spin-up

From the repo root:

```bash
docker compose up -d          # start Postgres on localhost:5434 (+ create the app role)
cp packages/persistence/.env.example packages/persistence/.env   # if you don't have one
pnpm -F @provable/persistence db:deploy   # apply migrations (tables, grants, RLS, immutability)
pnpm -F @provable/persistence test        # run the integration gates
```

Tear down: `docker compose down` (keep data) or `docker compose down -v` (wipe).

## How it works

- **Two roles.** Migrations run as the superuser via `DIRECT_URL` (bypass RLS for
  DDL). The app connects as `provable_app` via `DATABASE_URL` — a non-superuser,
  no-`BYPASSRLS` role that RLS fully governs.
- **`withTenant(orgId, fn)`** is the only query entry point. It opens an interactive
  transaction and sets the transaction-local GUC `app.current_org_id`; every RLS
  policy scopes rows to it. `is_local = true` ⇒ safe under connection pooling.
- **`verdict_event` is append-only** — a DB trigger rejects UPDATE/DELETE for every
  role (the app role also lacks the privilege).
- **Repositories** map Prisma rows → `@provable/contracts` types; Prisma types never
  leak past this package.

## Env

| Var            | Role          | Used by              |
| -------------- | ------------- | -------------------- |
| `DATABASE_URL` | `provable_app`| app (RLS-enforced)   |
| `DIRECT_URL`   | `postgres`    | `prisma migrate` only|
