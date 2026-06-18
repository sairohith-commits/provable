import { PrismaClient } from '@prisma/client';
import type { OrgId, Role } from '@provable/contracts';
import { assignRole, disconnect, provisionOrg } from '@provable/persistence';
import type { FastifyInstance } from 'fastify';
import { buildApp, generateApiKey } from '../src/index.js';

export const admin = new PrismaClient({
  datasources: { db: { url: process.env['DIRECT_URL'] ?? '' } },
});

const TABLES = ['api_key', 'membership', 'score', 'transition', 'verdict_event', 'decision', 'task', 'agent', 'org'];

export async function resetDb(): Promise<void> {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

/** The default Owner subject seeded by provision() — internalHeaders() forwards it by default
 *  so existing internal-path tests act as an authorized Owner under RBAC (Phase B). */
export function ownerSubject(orgId: string): string {
  return `owner:${orgId}`;
}

/** Provision an org with a fresh machine key AND a bootstrapped Owner; returns the raw key. */
export async function provision(orgId: string): Promise<string> {
  const k = generateApiKey();
  await provisionOrg(orgId as OrgId, k.prefix, k.hash, undefined, `owner@${orgId}.test`, ownerSubject(orgId));
  return k.key;
}

/** Seed (or re-assign) a member with a pre-bound subject — for per-role enforcement tests. */
export async function seedMember(
  orgId: string,
  subject: string,
  email: string,
  role: Role,
): Promise<void> {
  await assignRole(orgId as OrgId, email, role, subject);
}

export function makeApp(): FastifyInstance {
  return buildApp();
}

export async function teardown(app: FastifyInstance): Promise<void> {
  await app.close();
  await admin.$disconnect();
  await disconnect();
}

/** light-my-request helpers (minimal portable response type). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface InjectResponse {
  statusCode: number;
  payload: string;
  json: <T = any>() => T;
}

export function track(app: FastifyInstance, key: string, payload: unknown): Promise<InjectResponse> {
  return app.inject({
    method: 'POST',
    url: '/track',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    payload: payload as object,
  });
}

export function register(
  app: FastifyInstance,
  key: string,
  payload: unknown,
): Promise<InjectResponse> {
  return app.inject({
    method: 'POST',
    url: '/register',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    payload: payload as object,
  });
}

const BASE_MS = Date.parse('2026-06-15T00:00:00.000Z');
/** Deterministic, in-window timestamps (no wall clock). */
export function at(i: number): string {
  return new Date(BASE_MS + i * 60_000).toISOString();
}

/**
 * Headers for an internal (web↔api) call: token + web-resolved org id + the caller's provider
 * subject (used by the API to re-derive the RBAC role). `subject` defaults to the org's
 * bootstrapped Owner, so existing internal-path tests act as an Owner; pass an explicit subject
 * to exercise other roles or an unassigned caller.
 */
export function internalHeaders(
  token: string,
  orgId: string,
  approver?: string,
  subject?: string,
): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-provable-internal-token': token,
    'x-provable-org-id': orgId,
    'x-provable-subject': subject ?? ownerSubject(orgId),
    ...(approver !== undefined ? { 'x-provable-approver': approver } : {}),
  };
}

/** Drive a clean high-score climb to PENDING_APPROVAL (machine-key /track). */
export async function climbToPending(
  app: FastifyInstance,
  key: string,
  agentKey: string,
  taskKey: string,
  n = 14,
): Promise<InjectResponse> {
  await register(app, key, { agentKey, taskKey });
  let last!: InjectResponse;
  for (let i = 0; i < n; i += 1) {
    last = await track(app, key, {
      type: 'decision',
      agentKey,
      taskKey,
      at: at(i),
      action: { i },
      verdict: { kind: 'ACCEPTED' },
      outcome: 'SUCCESS',
      confidence: 0.95,
      source: 'sdk',
      externalRef: `${agentKey}:${taskKey}:${i}`,
    });
  }
  return last;
}
