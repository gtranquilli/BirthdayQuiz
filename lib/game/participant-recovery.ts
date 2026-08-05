import type { Session } from '@supabase/supabase-js';

import { isAvatarKey } from './avatars';
import {
  normalizeGameCode,
  removeStoredPlayer,
  saveStoredPlayer,
  type StoredPlayerEntry,
} from './lobby';
import {
  isRejoinToken,
  readRejoinToken,
  removeRejoinToken,
  saveRejoinToken,
} from './rejoin-token';
import { createClient } from '../supabase/client';

type BrowserSupabaseClient = ReturnType<typeof createClient>;

export type ParticipantRecoveryResult =
  | {
      readonly status: 'recovered';
      readonly player: StoredPlayerEntry;
      readonly rejoined: boolean;
    }
  | {
      readonly status: 'unavailable';
      readonly reason: 'missing' | 'invalid';
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function parsePlayer(value: unknown): StoredPlayerEntry | null {
  if (
    !isRecord(value) ||
    !isRecord(value.player) ||
    typeof value.player.nickname !== 'string' ||
    !isAvatarKey(value.player.avatarKey)
  ) {
    return null;
  }

  return {
    nickname: value.player.nickname,
    avatarKey: value.player.avatarKey,
  };
}

function getErrorMessage(value: unknown, fallback: string): string {
  return isRecord(value) && typeof value.error === 'string'
    ? value.error
    : fallback;
}

export async function getOrCreateAnonymousSession(
  supabase: BrowserSupabaseClient,
): Promise<Session> {
  const sessionResult = await supabase.auth.getSession();

  if (sessionResult.error) {
    throw new Error('Impossibile recuperare la sessione partecipante.');
  }

  if (sessionResult.data.session) {
    if (sessionResult.data.session.user.is_anonymous !== true) {
      throw new Error('È richiesta una sessione partecipante anonima.');
    }

    return sessionResult.data.session;
  }

  const signInResult = await supabase.auth.signInAnonymously();

  if (signInResult.error || !signInResult.data.session) {
    throw new Error('Impossibile creare la sessione anonima. Riprova tra poco.');
  }

  return signInResult.data.session;
}

async function provisionMissingRejoinToken(
  code: string,
  player: StoredPlayerEntry,
  accessToken: string,
): Promise<void> {
  const response = await fetch('/api/game-sessions/join', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      code,
      nickname: player.nickname,
      avatarKey: player.avatarKey,
      rotateRejoinToken: true,
    }),
  });
  const payload = await readJson(response);

  if (
    !response.ok ||
    !isRecord(payload) ||
    !isRejoinToken(payload.rejoinToken) ||
    !saveRejoinToken(code, payload.rejoinToken)
  ) {
    throw new Error(
      getErrorMessage(payload, 'Impossibile preparare il recupero della partecipazione.'),
    );
  }
}

export async function recoverParticipant(
  supabase: BrowserSupabaseClient,
  rawCode: string,
): Promise<ParticipantRecoveryResult> {
  const code = normalizeGameCode(rawCode);
  const sessionResult = await supabase.auth.getSession();

  if (sessionResult.error) {
    throw new Error('Impossibile recuperare la sessione partecipante.');
  }

  let session = sessionResult.data.session;

  if (session && session.user.is_anonymous !== true) {
    throw new Error('È richiesta una sessione partecipante anonima.');
  }

  if (session) {
    const response = await fetch(`/api/game-sessions/${code}/participant`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const payload = await readJson(response);

    if (response.ok) {
      const player = parsePlayer(payload);

      if (!player || !saveStoredPlayer(code, player)) {
        throw new Error('Impossibile salvare la partecipazione nel browser.');
      }

      if (!readRejoinToken(code)) {
        await provisionMissingRejoinToken(code, player, session.access_token);
      }

      return { status: 'recovered', player, rejoined: false };
    }

    if (response.status !== 404) {
      throw new Error(
        getErrorMessage(payload, 'Impossibile recuperare la partecipazione.'),
      );
    }
  }

  const currentRejoinToken = readRejoinToken(code);

  if (!currentRejoinToken) {
    removeStoredPlayer(code);
    return { status: 'unavailable', reason: 'missing' };
  }

  session ??= await getOrCreateAnonymousSession(supabase);

  const response = await fetch(`/api/game-sessions/${code}/rejoin`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ rejoinToken: currentRejoinToken }),
  });
  const payload = await readJson(response);

  if (response.status === 404 || response.status === 409) {
    removeRejoinToken(code);
    removeStoredPlayer(code);
    return { status: 'unavailable', reason: 'invalid' };
  }

  if (!response.ok) {
    throw new Error(
      getErrorMessage(payload, 'Impossibile recuperare la partecipazione.'),
    );
  }

  const player = parsePlayer(payload);
  const nextRejoinToken =
    isRecord(payload) && isRejoinToken(payload.rejoinToken)
      ? payload.rejoinToken
      : null;

  if (
    !player ||
    !nextRejoinToken ||
    !saveStoredPlayer(code, player) ||
    !saveRejoinToken(code, nextRejoinToken)
  ) {
    throw new Error('Il recupero non può essere salvato in questo browser.');
  }

  return { status: 'recovered', player, rejoined: true };
}
