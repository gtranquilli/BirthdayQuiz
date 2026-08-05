'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { AvatarBadge } from '@/components/avatar-badge';
import { isAvatarKey, type AvatarKey } from '@/lib/game/avatars';
import {
  getPlayerStorageKey,
  normalizeGameCode,
  parseStoredPlayerEntry,
  type StoredPlayerEntry,
} from '@/lib/game/lobby';
import { createClient } from '@/lib/supabase/client';
import {
  type LobbyConnectionStatus,
  useLobbySession,
} from '@/features/lobby/use-lobby-session';

interface PlayerLobbyProps {
  readonly code: string;
}

const CONNECTION_LABELS: Record<LobbyConnectionStatus, string> = {
  connecting: 'Connessione in corso…',
  connected: 'Connesso',
  offline: 'Offline',
  error: 'Connessione instabile',
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

function getErrorMessage(value: unknown, fallback: string): string {
  return isRecord(value) && typeof value.error === 'string'
    ? value.error
    : fallback;
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
    avatarKey: value.player.avatarKey as AvatarKey,
  };
}

function readStoredPlayer(code: string): StoredPlayerEntry | null {
  try {
    const storedValue = window.localStorage.getItem(getPlayerStorageKey(code));
    return storedValue
      ? parseStoredPlayerEntry(JSON.parse(storedValue) as unknown)
      : null;
  } catch {
    return null;
  }
}

export function PlayerLobby({ code: rawCode }: PlayerLobbyProps) {
  const code = normalizeGameCode(rawCode);
  const supabase = useMemo(() => createClient(), []);
  const { snapshot, loading, error, connectionStatus, refresh } =
    useLobbySession(code);
  const [player, setPlayer] = useState<StoredPlayerEntry | null>(null);
  const [recovering, setRecovering] = useState(true);
  const [playerError, setPlayerError] = useState<string | null>(null);

  const recoverPlayer = useCallback(async () => {
    const storedPlayer = readStoredPlayer(code);

    if (!storedPlayer) {
      setPlayerError(
        'Non troviamo la tua partecipazione su questo dispositivo. Entra di nuovo dalla home.',
      );
      setRecovering(false);
      return;
    }

    const sessionResult = await supabase.auth.getSession();
    const session = sessionResult.data.session;

    if (sessionResult.error || !session || session.user.is_anonymous !== true) {
      setPlayerError(
        'La sessione anonima non è più disponibile. Entra di nuovo dalla home.',
      );
      setRecovering(false);
      return;
    }

    const response = await fetch('/api/game-sessions/join', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code,
        nickname: storedPlayer.nickname,
        avatarKey: storedPlayer.avatarKey,
      }),
    });
    const payload = await readJson(response);

    if (!response.ok) {
      setPlayerError(
        getErrorMessage(payload, 'Impossibile recuperare la partecipazione.'),
      );
      setRecovering(false);
      return;
    }

    const recoveredPlayer = parsePlayer(payload);

    if (!recoveredPlayer) {
      setPlayerError('La partecipazione recuperata non è valida.');
      setRecovering(false);
      return;
    }

    setPlayer(recoveredPlayer);
    setPlayerError(null);
    setRecovering(false);
    void refresh();
  }, [code, refresh, supabase]);

  useEffect(() => {
    const recoveryId = window.setTimeout(() => {
      void recoverPlayer();
    }, 0);

    return () => window.clearTimeout(recoveryId);
  }, [recoverPlayer]);

  if (recovering || loading) {
    return (
      <main className='grid min-h-screen place-items-center bg-slate-100 p-6'>
        <p className='text-sm font-medium text-slate-600'>
          Recupero della lobby…
        </p>
      </main>
    );
  }

  if (playerError || error || !player || !snapshot) {
    return (
      <main className='grid min-h-screen place-items-center bg-slate-100 p-6'>
        <section className='w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200'>
          <h1 className='text-2xl font-bold text-slate-950'>Lobby non disponibile</h1>
          <p className='mt-3 text-sm text-slate-600'>
            {playerError ?? error ?? 'Impossibile caricare la stanza.'}
          </p>
          <Link
            className='mt-6 inline-flex rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white hover:bg-indigo-700'
            href='/'
          >
            Torna all’ingresso
          </Link>
        </section>
      </main>
    );
  }

  const waiting = snapshot.phase === 'lobby';

  return (
    <main className='min-h-screen bg-slate-100 px-4 py-8'>
      <div className='mx-auto max-w-lg'>
        <header className='flex items-center justify-between gap-3'>
          <p className='text-sm font-bold uppercase tracking-wide text-indigo-600'>
            Stanza {snapshot.code}
          </p>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              connectionStatus === 'connected'
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-amber-100 text-amber-900'
            }`}
          >
            {CONNECTION_LABELS[connectionStatus]}
          </span>
        </header>

        <section className='mt-6 rounded-3xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200'>
          <AvatarBadge avatarKey={player.avatarKey} size='lg' />
          <h1 className='mt-4 text-3xl font-black text-slate-950'>
            {player.nickname}
          </h1>
          <p className='mt-1 text-sm text-slate-500'>{snapshot.quizTitle}</p>

          <div
            className={`mt-7 rounded-2xl px-5 py-6 ${
              waiting
                ? 'bg-indigo-50 text-indigo-950'
                : 'bg-amber-50 text-amber-950'
            }`}
          >
            <p className='text-lg font-bold'>
              {waiting
                ? 'In attesa che l’host inizi'
                : 'La partita è già iniziata'}
            </p>
            <p className='mt-2 text-sm opacity-80'>
              {waiting
                ? 'Resta su questa pagina: la lobby si aggiorna automaticamente.'
                : 'Le domande non sono ancora disponibili in questa versione.'}
            </p>
          </div>

          <p className='mt-5 text-sm font-medium text-slate-600'>
            Giocatori: {snapshot.participantCount} / {snapshot.maxPlayers}
          </p>
        </section>
      </div>
    </main>
  );
}
