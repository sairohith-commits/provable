import { PrismaClient } from '@prisma/client';
import type { OrgId } from '@provable/contracts';
import { disconnect, provisionOrg } from '@provable/persistence';
import type { FastifyInstance } from 'fastify';
import { buildApp, generateApiKey } from '../src/index.js';

export const admin = new PrismaClient({
  datasources: { db: { url: process.env['DIRECT_URL'] ?? '' } },
});

const TABLES = ['score', 'transition', 'verdict_event', 'decision', 'task', 'agent', 'org'];

export async function resetDb(): Promise<void> {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

/** Provision an org with a fresh machine key; returns the raw key to present. */
export async function provision(orgId: string): Promise<string> {
  const k = generateApiKey();
  await provisionOrg(orgId as OrgId, k.prefix, k.hash);
  return k.key;
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
