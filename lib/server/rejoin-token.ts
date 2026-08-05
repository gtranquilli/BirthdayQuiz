import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

import { REJOIN_TOKEN_PATTERN } from '@/lib/game/rejoin-token';

export function generateRejoinToken(): string {
  return randomBytes(32).toString('base64url');
}

export function isValidRejoinToken(token: unknown): token is string {
  return typeof token === 'string' && REJOIN_TOKEN_PATTERN.test(token);
}

export function hashRejoinToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
