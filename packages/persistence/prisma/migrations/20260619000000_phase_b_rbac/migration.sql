-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'APPROVER', 'OPERATOR', 'VIEWER');

-- CreateTable
CREATE TABLE "membership" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "subject" TEXT,
    "role" "Role" NOT NULL,
    "invitedBySubject" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "boundAt" TIMESTAMP(3),

    CONSTRAINT "membership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "membership_orgId_idx" ON "membership"("orgId");

-- CreateIndex
CREATE INDEX "membership_orgId_subject_idx" ON "membership"("orgId", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "membership_orgId_email_key" ON "membership"("orgId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "membership_orgId_subject_key" ON "membership"("orgId", "subject");

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Phase B RBAC: app-role grants + Row-Level Security for membership ──
-- Owner-managed people list needs DELETE (no other table grants it). Tenant-scoped exactly
-- like every other table: rows are visible only within the matching app.current_org_id GUC.
GRANT SELECT, INSERT, UPDATE, DELETE ON "membership" TO provable_app;

-- ENABLE (not FORCE) — the SAME mode as every other table after the Neon-compat migration.
-- The table OWNER (migrations) bypasses RLS; the app role provable_app is a NON-owner with
-- NO BYPASSRLS, so RLS still scopes every app query → two-tenant isolation holds. FORCE would
-- break owner-context paths on managed hosts (Neon) for no real isolation gain (see
-- 20260618000000_neon_compat_no_force_rls).
ALTER TABLE "membership" ENABLE ROW LEVEL SECURITY;

CREATE POLICY membership_tenant_isolation ON "membership" FOR ALL
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));
