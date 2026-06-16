-- Runs once on a fresh Postgres data volume (as the postgres superuser, in DB `provable`).
--
-- Creates the application role used by the running app. It is a plain LOGIN role:
--   * NOT a superuser
--   * NO BYPASSRLS
-- so Row-Level Security applies to it in full. The superuser (postgres) owns the
-- tables and runs migrations, bypassing RLS for DDL/seed only.
CREATE ROLE provable_app WITH LOGIN PASSWORD 'provable_app';
GRANT CONNECT ON DATABASE provable TO provable_app;
GRANT USAGE ON SCHEMA public TO provable_app;
