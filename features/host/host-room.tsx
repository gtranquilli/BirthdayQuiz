'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { AvatarBadge } from '@/components/avatar-badge';
import { useLobbySession } from '@/features/lobby/use-lobby-session';
import { normalizeGameCode } from '@/lib/game/lobby';

interface HostRoomPlayer {
  readonly id: string;
  readonly nickname: string;
  readonly avatarKey: string;
  readonly joinedAt: string;
}

interface HostRoomSession {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly presetName: string;
  readonly phase: string;
  readonly participantCount: number;
  readonly maxPlayers: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly players: readonly HostRoomPlayer[];
}

interface HostRoomProps {
  readonly code: string;
}

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

function parseSession(value: unknown): HostRoomSession | null {
  if (!isRecord(value) || !isRecord(value.session)) {
    return null;
  }

  const session = value.session;

  if (
    typeof session.id !== 'string' ||
    typeof session.code !== 'string' ||
    typeof session.title !== 'string' ||
    typeof session.presetName !== 'string' ||
    typeof session.phase !== 'string' ||
    typeof session.participantCount !== 'number' ||
    typeof session.maxPlayers !== 'number' ||
    typeof session.createdAt !== 'string' ||
    typeof session.updatedAt !== 'string' ||
    !Array.isArray(session.players)
  ) {
    return null;
  }

  const players: HostRoomPlayer[] = [];

  for (const player of session.players) {
    if (
      !isRecord(player) ||
      typeof player.id !== 'string' ||
      typeof player.nickname !== 'string' ||
      typeof player.avatarKey !== 'string' ||
      typeof player.joinedAt !== 'string'
    ) {
      return null;
    }

    players.push({
      id: player.id,
      nickname: player.nickname,
      avatarKey: player.avatarKey,
      joinedAt: player.joinedAt,
    });
  }

  return {
    id: session.id,
    code: session.code,
    title: session.title,
    presetName: session.presetName,
    phase: session.phase,
    participantCount: session.participantCount,
    maxPlayers: session.maxPlayers,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    players,
  };
}

export function HostRoom({ code: rawCode }: HostRoomProps) {
  const router = useRouter();
  const code = normalizeGameCode(rawCode);
  const { snapshot, connectionStatus, refresh } = useLobbySession(code);
  const [session, setSession] = useState<HostRoomSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingPlayerId, setRemovingPlayerId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [starting, setStarting] = useState(false);

  const loadSession = useCallback(async () => {
    const response = await fetch(`/api/host/game-sessions/${code}`, {
      cache: 'no-store',
    });
    const payload = await readJson(response);

    if (response.status === 401) {
      router.push('/host');
      return;
    }

    if (!response.ok) {
      setError(getErrorMessage(payload, 'Impossibile caricare la stanza.'));
      setLoading(false);
      return;
    }

    const loadedSession = parseSession(payload);

    if (!loadedSession) {
      setError('La risposta della stanza non è valida.');
      setLoading(false);
      return;
    }

    setSession(loadedSession);
    setError(null);
    setLoading(false);
  }, [code, router]);

  useEffect(() => {
    const loadId = window.setTimeout(() => void loadSession(), 0);
    return () => window.clearTimeout(loadId);
  }, [loadSession, snapshot]);

  async function removePlayer(player: HostRoomPlayer) {
    if (!window.confirm(`Rimuovere ${player.nickname} dalla lobby?`)) {
      return;
    }

    setRemovingPlayerId(player.id);
    setError(null);

    try {
      const response = await fetch(
        `/api/host/game-sessions/${code}/players/${player.id}`,
        { method: 'DELETE' },
      );
      const payload = await readJson(response);

      if (!response.ok) {
        throw new Error(
          getErrorMessage(payload, 'Impossibile rimuovere il giocatore.'),
        );
      }

      await Promise.all([loadSession(), refresh()]);
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : 'Impossibile rimuovere il giocatore.',
      );
    } finally {
      setRemovingPlayerId(null);
    }
  }

  async function cancelSession() {
    if (!window.confirm('Annullare definitivamente questa stanza?')) {
      return;
    }

    setCancelling(true);
    setError(null);

    try {
      const response = await fetch(`/api/host/game-sessions/${code}`, {
        method: 'DELETE',
      });
      const payload = await readJson(response);

      if (!response.ok) {
        throw new Error(
          getErrorMessage(payload, 'Impossibile annullare la stanza.'),
        );
      }

      router.push('/host');
      router.refresh();
    } catch (cancelError) {
      setError(
        cancelError instanceof Error
          ? cancelError.message
          : 'Impossibile annullare la stanza.',
      );
      setCancelling(false);
    }
  }

  async function startGame() {
    setStarting(true);
    setError(null);

    try {
      const response = await fetch(`/api/host/game-sessions/${code}/start`, {
        method: 'POST',
      });
      const payload = await readJson(response);

      if (!response.ok) {
        throw new Error(getErrorMessage(payload, 'Impossibile avviare il quiz.'));
      }

      await loadSession();
    } catch (startError) {
      setError(
        startError instanceof Error
          ? startError.message
          : 'Impossibile avviare il quiz.',
      );
    } finally {
      setStarting(false);
    }
  }

  if (loading) {
    return (
      <main className='grid min-h-screen place-items-center bg-slate-100 p-6'>
        <p className='text-sm font-medium text-slate-600'>Caricamento stanza…</p>
      </main>
    );
  }

  if (!session) {
    return (
      <main className='grid min-h-screen place-items-center bg-slate-100 p-6'>
        <section className='w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200'>
          <h1 className='text-2xl font-bold text-slate-950'>Stanza non disponibile</h1>
          <p className='mt-3 text-sm text-slate-600'>
            {error ?? 'Impossibile caricare la stanza.'}
          </p>
          <Link
            className='mt-6 inline-flex rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white'
            href='/host'
          >
            Torna alle stanze
          </Link>
        </section>
      </main>
    );
  }

  const effectivePhase = snapshot?.phase ?? session.phase;
  const isLobby = effectivePhase === 'lobby';
  const currentQuestion = snapshot?.currentQuestion ?? null;
  const participantCount =
    snapshot?.participantCount ?? session.participantCount;

  return (
    <main className='min-h-screen bg-slate-100 px-4 py-8 sm:px-6'>
      <div className='mx-auto max-w-4xl'>
        <header className='flex flex-wrap items-start justify-between gap-4'>
          <div>
            <Link
              className='text-sm font-semibold text-indigo-700 hover:text-indigo-900'
              href='/host'
            >
              ← Tutte le stanze
            </Link>
            <h1 className='mt-2 text-3xl font-black text-slate-950'>
              {session.title}
            </h1>
            <p className='mt-1 text-sm text-slate-600'>{session.presetName}</p>
          </div>
          <span
            className={`rounded-full px-3 py-1.5 text-sm font-bold ${
              connectionStatus === 'connected'
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-amber-100 text-amber-900'
            }`}
          >
            {connectionStatus === 'connected' ? 'Sincronizzata' : 'Riconnessione…'}
          </span>
        </header>

        {error ? (
          <p className='mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100'>
            {error}
          </p>
        ) : null}

        <section className='mt-6 grid gap-4 sm:grid-cols-3'>
          <div className='rounded-2xl bg-indigo-600 p-5 text-white sm:col-span-1'>
            <p className='text-xs font-bold uppercase tracking-[0.2em] text-indigo-200'>
              Codice stanza
            </p>
            <p className='mt-3 text-4xl font-black tracking-[0.18em]'>
              {session.code}
            </p>
          </div>
          <dl className='grid gap-4 rounded-2xl bg-white p-5 ring-1 ring-slate-200 sm:col-span-2 sm:grid-cols-3'>
            <div>
              <dt className='text-xs font-bold uppercase text-slate-500'>Fase</dt>
              <dd className='mt-1 font-bold text-slate-950'>{effectivePhase}</dd>
            </div>
            <div>
              <dt className='text-xs font-bold uppercase text-slate-500'>Giocatori</dt>
              <dd className='mt-1 font-bold text-slate-950'>
                {participantCount} / {session.maxPlayers}
              </dd>
            </div>
            <div>
              <dt className='text-xs font-bold uppercase text-slate-500'>Creata</dt>
              <dd className='mt-1 text-sm font-medium text-slate-950'>
                {new Date(session.createdAt).toLocaleString('it-IT')}
              </dd>
            </div>
          </dl>
        </section>

        <div className='mt-5 flex flex-wrap gap-3'>
          {isLobby ? (
            <button
              className='rounded-xl bg-indigo-600 px-4 py-2.5 font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50'
              type='button'
              onClick={() => void startGame()}
              disabled={participantCount < 1 || starting}
            >
              {starting ? 'Avvio in corso…' : 'Avvia quiz'}
            </button>
          ) : null}
          <a
            className='rounded-xl bg-slate-900 px-4 py-2.5 font-semibold text-white hover:bg-slate-700'
            href={`/display/${session.code}`}
            target='_blank'
            rel='noreferrer'
          >
            Apri display
          </a>
          <button
            className='rounded-xl border border-red-300 bg-white px-4 py-2.5 font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50'
            type='button'
            onClick={() => void cancelSession()}
            disabled={!isLobby || cancelling}
          >
            {cancelling ? 'Annullamento…' : 'Annulla stanza'}
          </button>
        </div>

        {!isLobby ? (
          <p className='mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900'>
            La gestione dei giocatori è disponibile soltanto durante la lobby.
          </p>
        ) : null}

        {effectivePhase === 'voting_open' && currentQuestion ? (
          <section className='mt-7 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7'>
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <p className='text-sm font-bold uppercase tracking-wide text-indigo-700'>
                Domanda {(snapshot?.currentQuestionIndex ?? 0) + 1} /{' '}
                {snapshot?.totalQuestionCount ?? 0}
              </p>
              <p className='text-sm font-semibold text-slate-600'>
                Voti ricevuti: {snapshot?.votedCount ?? 0} /{' '}
                {participantCount}
              </p>
            </div>
            <p className='mt-2 text-sm font-semibold text-slate-500'>
              {currentQuestion.category}
            </p>
            <h2 className='mt-2 text-2xl font-black text-slate-950'>
              {currentQuestion.prompt}
            </h2>
            <ol className='mt-5 grid gap-3 sm:grid-cols-2'>
              {currentQuestion.options.map((option) => (
                <li
                  className='rounded-xl bg-slate-50 px-4 py-3 font-semibold text-slate-800 ring-1 ring-slate-200'
                  key={option.id}
                >
                  {option.position}. {option.text}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <section className='mt-7 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7'>
          <div className='flex items-center justify-between gap-4'>
            <h2 className='text-xl font-black text-slate-950'>Giocatori in lobby</h2>
            <span className='text-sm font-semibold text-slate-500'>
              {session.players.length} presenti
            </span>
          </div>

          {session.players.length === 0 ? (
            <p className='mt-6 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500'>
              Nessun giocatore è ancora entrato.
            </p>
          ) : (
            <ul className='mt-5 divide-y divide-slate-200'>
              {session.players.map((player) => (
                <li
                  className='flex items-center gap-4 py-4 first:pt-0 last:pb-0'
                  key={player.id}
                >
                  <AvatarBadge avatarKey={player.avatarKey} size='sm' />
                  <div className='min-w-0 flex-1'>
                    <p className='truncate font-bold text-slate-950'>
                      {player.nickname}
                    </p>
                    <p className='text-xs text-slate-500'>
                      Entrato alle {new Date(player.joinedAt).toLocaleTimeString('it-IT')}
                    </p>
                  </div>
                  <button
                    className='rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50'
                    type='button'
                    onClick={() => void removePlayer(player)}
                    disabled={!isLobby || removingPlayerId !== null}
                  >
                    {removingPlayerId === player.id ? 'Rimozione…' : 'Rimuovi'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
