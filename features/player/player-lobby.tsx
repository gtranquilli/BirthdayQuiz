'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AvatarBadge } from '@/components/avatar-badge';
import { getAnswerPositionLabel } from '@/lib/game/answer-position';
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

type VoteStatus = 'idle' | 'recovering' | 'submitting' | 'saved' | 'error';

interface VoteResultRow {
  readonly selected_option_id: string;
  readonly voted_count: number;
  readonly current_question_index: number;
}

interface SupabaseErrorLike {
  readonly code?: string;
  readonly message?: string;
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

function parseVoteResult(value: unknown): VoteResultRow | null {
  const row = Array.isArray(value) ? (value[0] as unknown) : null;

  if (
    !isRecord(row) ||
    typeof row.selected_option_id !== 'string' ||
    typeof row.voted_count !== 'number' ||
    typeof row.current_question_index !== 'number'
  ) {
    return null;
  }

  return {
    selected_option_id: row.selected_option_id,
    voted_count: row.voted_count,
    current_question_index: row.current_question_index,
  };
}

function getVoteErrorMessage(error: SupabaseErrorLike): string {
  if (error.code === 'P0001') {
    return 'La votazione è chiusa. La risposta non è stata modificata.';
  }

  if (error.code === '22023') {
    return 'Questa risposta non è valida per la domanda corrente.';
  }

  if (error.code === 'P0002') {
    return error.message?.includes('Player not found')
      ? 'Non risulti tra i partecipanti di questa stanza.'
      : 'La stanza non è più disponibile.';
  }

  if (error.code === '42501') {
    return 'La sessione anonima non è più valida. Entra nuovamente nella stanza.';
  }

  return 'Errore di rete o servizio non disponibile. Riprova.';
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
  const [savedOptionId, setSavedOptionId] = useState<string | null>(null);
  const [voteStatus, setVoteStatus] = useState<VoteStatus>('idle');
  const [voteError, setVoteError] = useState<string | null>(null);
  const voteRequestInFlight = useRef(false);

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

    setVoteStatus('recovering');
    const currentVoteResult = await supabase.rpc('get_my_current_vote', {
      p_code: code,
    });

    if (currentVoteResult.error) {
      setVoteStatus('error');
      setVoteError(getVoteErrorMessage(currentVoteResult.error));
    } else if (
      currentVoteResult.data === null ||
      typeof currentVoteResult.data === 'string'
    ) {
      setSavedOptionId(currentVoteResult.data);
      setVoteStatus(currentVoteResult.data === null ? 'idle' : 'saved');
      setVoteError(null);
    } else {
      setVoteStatus('error');
      setVoteError('Impossibile recuperare il voto registrato. Riprova.');
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

  async function submitVote(optionId: string) {
    if (voteRequestInFlight.current || optionId === savedOptionId) {
      return;
    }

    if (!navigator.onLine) {
      setVoteStatus('error');
      setVoteError('Sei offline. Riconnettiti e riprova.');
      return;
    }

    voteRequestInFlight.current = true;
    setVoteStatus('submitting');
    setVoteError(null);

    try {
      const result = await supabase.rpc('submit_vote', {
        p_code: code,
        p_game_answer_option_id: optionId,
      });

      if (result.error) {
        setVoteStatus('error');
        setVoteError(getVoteErrorMessage(result.error));
        return;
      }

      const savedVote = parseVoteResult(result.data);

      if (!savedVote) {
        setVoteStatus('error');
        setVoteError('Il server ha restituito un voto non valido. Riprova.');
        return;
      }

      setSavedOptionId(savedVote.selected_option_id);
      setVoteStatus('saved');
      setVoteError(null);
    } catch {
      setVoteStatus('error');
      setVoteError('Errore di rete. Controlla la connessione e riprova.');
    } finally {
      voteRequestInFlight.current = false;
    }
  }

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

  if (snapshot.phase === 'voting_open' && snapshot.currentQuestion) {
    const question = snapshot.currentQuestion;

    return (
      <main className='min-h-screen bg-slate-100 px-4 py-6'>
        <div className='mx-auto max-w-lg'>
          <header className='flex items-center justify-between gap-3'>
            <div className='flex min-w-0 items-center gap-3'>
              <AvatarBadge avatarKey={player.avatarKey} size='sm' />
              <div className='min-w-0'>
                <p className='truncate font-bold text-slate-950'>{player.nickname}</p>
                <p className='text-xs font-semibold text-indigo-700'>
                  Domanda {(snapshot.currentQuestionIndex ?? 0) + 1} /{' '}
                  {snapshot.totalQuestionCount}
                </p>
              </div>
            </div>
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

          <section className='mt-6 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7'>
            <p className='text-sm font-bold uppercase tracking-wide text-indigo-700'>
              {question.category}
            </p>
            <h1 className='mt-3 text-2xl font-black leading-tight text-slate-950'>
              {question.prompt}
            </h1>

            <div className='mt-6 grid gap-3'>
              {question.options.map((option) => {
                const selected = savedOptionId === option.id;

                return (
                  <button
                    aria-pressed={selected}
                    className={`min-h-16 rounded-2xl px-4 py-3 text-left font-bold ring-2 transition-colors ${
                      selected
                        ? 'bg-indigo-600 text-white ring-indigo-600'
                        : 'bg-slate-50 text-slate-900 ring-slate-200 hover:ring-indigo-300'
                    }`}
                    key={option.id}
                    type='button'
                    onClick={() => void submitVote(option.id)}
                    disabled={voteStatus === 'submitting'}
                  >
                    <span className='mr-3 opacity-70'>
                      {getAnswerPositionLabel(option.position)}.
                    </span>
                    {option.text}
                  </button>
                );
              })}
            </div>

            <p
              className={`mt-5 rounded-xl px-4 py-3 text-center text-sm font-medium ${
                voteStatus === 'error'
                  ? 'bg-red-50 text-red-800'
                  : voteStatus === 'saved'
                    ? 'bg-emerald-50 text-emerald-800'
                    : 'bg-amber-50 text-amber-900'
              }`}
            >
              {voteStatus === 'submitting'
                ? 'Invio del voto in corso…'
                : voteStatus === 'saved'
                  ? 'Voto registrato. Puoi cambiare risposta finché la votazione resta aperta.'
                  : voteStatus === 'error'
                    ? voteError
                    : 'Seleziona una risposta per registrare il voto.'}
            </p>
          </section>
        </div>
      </main>
    );
  }

  if (snapshot.phase === 'answer_revealed') {
    const question = snapshot.currentQuestion;
    const correctOption = question.options.find((option) => option.isCorrect);
    const selectedOption = question.options.find(
      (option) => option.id === savedOptionId,
    );
    const answeredCorrectly = savedOptionId === snapshot.correctOptionId;

    return (
      <main className='min-h-screen bg-slate-100 px-4 py-6'>
        <div className='mx-auto max-w-lg'>
          <header className='flex items-center justify-between gap-3'>
            <div className='flex min-w-0 items-center gap-3'>
              <AvatarBadge avatarKey={player.avatarKey} size='sm' />
              <div className='min-w-0'>
                <p className='truncate font-bold text-slate-950'>{player.nickname}</p>
                <p className='text-xs font-semibold text-emerald-700'>
                  Risposta rivelata · Domanda {snapshot.currentQuestionIndex + 1}
                </p>
              </div>
            </div>
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

          <section className='mt-6 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7'>
            <p className='text-sm font-bold uppercase tracking-wide text-emerald-700'>
              {question.category}
            </p>
            <h1 className='mt-3 text-2xl font-black leading-tight text-slate-950'>
              {question.prompt}
            </h1>

            <ol className='mt-6 grid gap-3'>
              {question.options.map((option) => {
                const selected = option.id === savedOptionId;

                return (
                  <li
                    className={`rounded-2xl px-4 py-3 font-bold ring-2 ${
                      option.isCorrect
                        ? 'bg-emerald-50 text-emerald-950 ring-emerald-500'
                        : selected
                          ? 'bg-red-50 text-red-950 ring-red-400'
                          : 'bg-slate-50 text-slate-700 ring-slate-200'
                    }`}
                    key={option.id}
                  >
                    <div className='flex items-center justify-between gap-3'>
                      <span>
                        {getAnswerPositionLabel(option.position)}. {option.text}
                      </span>
                      <span className='text-xs font-black uppercase tracking-wide'>
                        {option.isCorrect
                          ? 'Corretta'
                          : selected
                            ? 'La tua scelta'
                            : ''}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>

            <div
              className={`mt-6 rounded-2xl px-5 py-4 text-center ${
                savedOptionId === null
                  ? 'bg-amber-50 text-amber-950'
                  : answeredCorrectly
                    ? 'bg-emerald-50 text-emerald-950'
                    : 'bg-red-50 text-red-950'
              }`}
            >
              <p className='text-lg font-black'>
                {savedOptionId === null
                  ? 'Non hai risposto'
                  : answeredCorrectly
                    ? 'Risposta corretta!'
                    : 'Risposta errata'}
              </p>
              <p className='mt-1 text-sm font-medium'>
                La risposta corretta è{' '}
                {correctOption
                  ? `${getAnswerPositionLabel(correctOption.position)}. ${correctOption.text}`
                  : 'non disponibile'}
                {selectedOption && !answeredCorrectly
                  ? ` La tua scelta era ${getAnswerPositionLabel(selectedOption.position)}.`
                  : ''}
              </p>
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (snapshot.phase === 'voting_closed') {
    return (
      <main className='grid min-h-screen place-items-center bg-slate-100 p-6'>
        <section className='w-full max-w-md rounded-3xl bg-white p-7 text-center shadow-sm ring-1 ring-slate-200'>
          <AvatarBadge avatarKey={player.avatarKey} size='lg' />
          <h1 className='mt-4 text-2xl font-black text-slate-950'>
            Votazione chiusa
          </h1>
          <p className='mt-3 text-sm text-slate-600'>
            La tua risposta non può più essere modificata. Attendi che l’host mostri la soluzione.
          </p>
          {savedOptionId ? (
            <p className='mt-5 rounded-xl bg-indigo-50 px-4 py-3 font-semibold text-indigo-900'>
              Voto registrato
            </p>
          ) : null}
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
