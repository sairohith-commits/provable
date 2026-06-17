import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { KeyLike } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { beginLogin, completeLogin, refresh, resetOidcConfig } from '../src/lib/auth/oidc/discovery';

// In-process OIDC issuer: serves discovery + JWKS + a token endpoint that mints RS256 ID tokens.
// Full Authorization Code + PKCE flow → AuthContext identity, then a refresh-token exchange.
// CSRF (state/nonce/PKCE) is enforced by openid-client itself — this test proves our wiring.

const CLIENT_ID = 'provable-test';
const CLIENT_SECRET = 'shh-secret';
const KID = 'test-key-1';

let server: Server;
let issuer: string;
let priv: KeyLike;
const REDIRECT = 'http://127.0.0.1:9/api/auth/callback';

// A mock auth code carries the would-be ID-token claims (the real AS would persist them from the
// authorization request). nonce is round-tripped so openid-client's nonce check passes.
function encodeCode(payload: object): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}
function decodeCode(code: string): { sub: string; email: string; name: string; nonce?: string } {
  return JSON.parse(Buffer.from(code, 'base64url').toString('utf8'));
}

async function idToken(claims: { sub: string; email: string; name: string; nonce?: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT({
    email: claims.email,
    name: claims.name,
    ...(claims.nonce !== undefined ? { nonce: claims.nonce } : {}),
  })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(issuer)
    .setSubject(claims.sub)
    .setAudience(CLIENT_ID)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600);
  return jwt.sign(priv);
}

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  priv = privateKey;
  const jwk = { ...(await exportJWK(publicKey)), kid: KID, use: 'sig', alg: 'RS256' };

  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', issuer);
    if (url.pathname === '/.well-known/openid-configuration') {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          end_session_endpoint: `${issuer}/endsession`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          token_endpoint_auth_methods_supported: ['client_secret_post'],
          code_challenge_methods_supported: ['S256'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          scopes_supported: ['openid', 'profile', 'email'],
        }),
      );
      return;
    }
    if (url.pathname === '/jwks') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        void (async () => {
          const form = new URLSearchParams(body);
          const grant = form.get('grant_type');
          let claims: { sub: string; email: string; name: string; nonce?: string };
          if (grant === 'authorization_code') {
            claims = decodeCode(form.get('code') ?? '');
          } else {
            // refresh_token carries `rt:<encoded-claims>`; drop the nonce on refresh.
            const rt = form.get('refresh_token') ?? '';
            const { sub, email, name } = decodeCode(rt.replace(/^rt:/, ''));
            claims = { sub, email, name };
          }
          const token = await idToken(claims);
          const code = form.get('code') ?? `${claims.sub}`;
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              access_token: 'access-token-xyz',
              id_token: token,
              refresh_token: `rt:${grant === 'authorization_code' ? code : encodeCode(claims)}`,
              token_type: 'Bearer',
              expires_in: 3600,
            }),
          );
        })();
      });
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  issuer = `http://127.0.0.1:${port}`;

  process.env['OIDC_ISSUER'] = issuer;
  process.env['OIDC_CLIENT_ID'] = CLIENT_ID;
  process.env['OIDC_CLIENT_SECRET'] = CLIENT_SECRET;
  process.env['OIDC_REDIRECT_URI'] = REDIRECT;
  process.env['OIDC_ALLOW_INSECURE'] = 'true';
  resetOidcConfig();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const k of [
    'OIDC_ISSUER',
    'OIDC_CLIENT_ID',
    'OIDC_CLIENT_SECRET',
    'OIDC_REDIRECT_URI',
    'OIDC_ALLOW_INSECURE',
  ]) {
    delete process.env[k];
  }
  resetOidcConfig();
});

describe('OIDC Authorization Code + PKCE against a mock issuer', () => {
  it('logs in → resolves the verified identity (sub/email/name)', async () => {
    const challenge = await beginLogin();
    expect(challenge.authorizationUrl).toContain('code_challenge=');
    expect(challenge.authorizationUrl).toContain('code_challenge_method=S256');
    expect(challenge.state).toBeTruthy();
    expect(challenge.nonce).toBeTruthy();

    // Simulate the IdP redirect back: a code carrying the user's claims + the round-tripped nonce.
    const code = encodeCode({
      sub: 'oidc-user-7',
      email: 'dev@corp.example',
      name: 'Dev User',
      nonce: challenge.nonce,
    });
    const callbackUrl = new URL(REDIRECT);
    callbackUrl.searchParams.set('code', code);
    callbackUrl.searchParams.set('state', challenge.state);

    const { identity, refreshToken } = await completeLogin(callbackUrl, {
      state: challenge.state,
      nonce: challenge.nonce,
      codeVerifier: challenge.codeVerifier,
    });
    expect(identity).toEqual({ userId: 'oidc-user-7', email: 'dev@corp.example', displayName: 'Dev User' });
    expect(refreshToken).toBeTruthy();
  });

  it('rejects a mismatched state (CSRF protection via openid-client)', async () => {
    const challenge = await beginLogin();
    const code = encodeCode({ sub: 'x', email: 'x@y', name: 'X', nonce: challenge.nonce });
    const callbackUrl = new URL(REDIRECT);
    callbackUrl.searchParams.set('code', code);
    callbackUrl.searchParams.set('state', 'tampered-state');
    await expect(
      completeLogin(callbackUrl, {
        state: challenge.state,
        nonce: challenge.nonce,
        codeVerifier: challenge.codeVerifier,
      }),
    ).rejects.toThrow();
  });

  it('refreshes the session via the refresh token (IdP-side refresh)', async () => {
    const refreshToken = `rt:${encodeCode({ sub: 'oidc-user-7', email: 'dev@corp.example', name: 'Dev User' })}`;
    const { identity } = await refresh(refreshToken);
    expect(identity.userId).toBe('oidc-user-7');
  });
});
