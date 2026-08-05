import { normalizeGameCode } from './lobby';

const REJOIN_STORAGE_PREFIX = 'quiz-engine:rejoin:';
export const REJOIN_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function getRejoinTokenStorageKey(code: string): string {
  return `${REJOIN_STORAGE_PREFIX}${normalizeGameCode(code)}`;
}

export function isRejoinToken(value: unknown): value is string {
  return typeof value === 'string' && REJOIN_TOKEN_PATTERN.test(value);
}

export function readRejoinToken(code: string): string | null {
  try {
    const storageKey = getRejoinTokenStorageKey(code);
    const token = window.localStorage.getItem(storageKey);

    if (token !== null && !isRejoinToken(token)) {
      window.localStorage.removeItem(storageKey);
      return null;
    }

    return token;
  } catch {
    return null;
  }
}

export function saveRejoinToken(code: string, token: string): boolean {
  if (!isRejoinToken(token)) {
    return false;
  }

  try {
    window.localStorage.setItem(getRejoinTokenStorageKey(code), token);
    return true;
  } catch {
    return false;
  }
}

export function removeRejoinToken(code: string): void {
  try {
    window.localStorage.removeItem(getRejoinTokenStorageKey(code));
  } catch {
    // Storage may be unavailable in private browsing; recovery remains optional.
  }
}
