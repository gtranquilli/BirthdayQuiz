import 'server-only';

import {
  createHash,
  createHmac,
  timingSafeEqual,
} from 'node:crypto';
import { cookies } from 'next/headers';

export const HOST_SESSION_COOKIE_NAME = 'quiz_engine_host_session';

const HOST_SESSION_TTL_SECONDS = 12 * 60 * 60;

interface HostSessionPayload {
  readonly version: 1;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

function getHostPassword(): string {
  const password = process.env.HOST_ACCESS_PASSWORD;

  if (!password) {
    throw new Error('HOST_ACCESS_PASSWORD is not configured');
  }

  return password;
}

function getHostSessionSecret(): string {
  const secret = process.env.HOST_SESSION_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error('HOST_SESSION_SECRET must contain at least 32 characters');
  }

  return secret;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function sign(encodedPayload: string): Buffer {
  return createHmac('sha256', getHostSessionSecret())
    .update(encodedPayload, 'utf8')
    .digest();
}

function isHostSessionPayload(value: unknown): value is HostSessionPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const payload = value as Record<string, unknown>;

  return (
    payload.version === 1 &&
    typeof payload.issuedAt === 'number' &&
    Number.isInteger(payload.issuedAt) &&
    typeof payload.expiresAt === 'number' &&
    Number.isInteger(payload.expiresAt)
  );
}

export function verifyHostPassword(candidate: string): boolean {
  return timingSafeEqual(digest(candidate), digest(getHostPassword()));
}

export function createHostSessionToken(): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: HostSessionPayload = {
    version: 1,
    issuedAt,
    expiresAt: issuedAt + HOST_SESSION_TTL_SECONDS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  );
  const signature = sign(encodedPayload).toString('base64url');

  return `${encodedPayload}.${signature}`;
}

export function verifyHostSessionToken(token: string | undefined): boolean {
  if (!token) {
    return false;
  }

  const tokenParts = token.split('.');

  if (tokenParts.length !== 2) {
    return false;
  }

  const [encodedPayload, encodedSignature] = tokenParts;

  try {
    const providedSignature = Buffer.from(encodedSignature, 'base64url');
    const expectedSignature = sign(encodedPayload);

    if (
      providedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(providedSignature, expectedSignature)
    ) {
      return false;
    }

    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as unknown;

    if (!isHostSessionPayload(payload)) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);

    return payload.issuedAt <= now + 60 && payload.expiresAt > now;
  } catch {
    return false;
  }
}

export async function hasValidHostSession(): Promise<boolean> {
  const cookieStore = await cookies();

  return verifyHostSessionToken(
    cookieStore.get(HOST_SESSION_COOKIE_NAME)?.value,
  );
}

export function getHostSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: HOST_SESSION_TTL_SECONDS,
  };
}
