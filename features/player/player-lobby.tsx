'use client';

import Link from 'next/link';
import { ExamPlayer } from '@/features/exam/exam-player';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AvatarBadge } from '@/components/avatar-badge';
import { Leaderboard } from '@/components/leaderboard';
import { QuizMediaImage } from '@/components/quiz-media-image';
import { getAnswerPositionLabel } from '@/lib/game/answer-position';
import { getFinalResultComment } from '@/lib/game/final-result-comment';
import { normalizeGameCode, type StoredPlayerEntry } from '@/lib/game/lobby';
import { recoverParticipant } from '@/lib/game/participant-recovery';
import { formatCompetitionRank, isRankTied } from '@/lib/game/ranking';
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

export function PlayerLobby({ code: rawCode }: PlayerLobbyProps) {
  const code = normalizeGameCode(rawCode);
  const router = useRouter();
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
  const recoveredVoteQuestionId = useRef<string | null>(null);

  const recoverPlayer = useCallback(async () => {
    try {
      const result = await recoverParticipant(supabase, code);

      if (result.status === 'unavailable') {
        router.replace(`/join/${code}?recovery=failed`);
        return;
      }

      setPlayer(result.player);
      setPlayerError(null);
      setRecovering(false);
      void refresh();
    } catch {
      setPlayerError(
        'Impossibile recuperare la partecipazione. Controlla la connessione e riprova.',
      );
      setRecovering(false);
    }
  }, [code, refresh, router, supabase]);

  useEffect(() => {
    const recoveryId = window.setTimeout(() => {
      void recoverPlayer();
    }, 0);

    return () => window.clearTimeout(recoveryId);
  }, [recoverPlayer]);

  const currentQuestionId =
    snapshot?.mode !== 'exam' && (snapshot?.phase === 'voting_open' ||
    snapshot?.phase === 'voting_closed' ||
    snapshot?.phase === 'answer_revealed')
      ? snapshot.currentQuestion.id
      : null;

  useEffect(() => {
    if (!player) {
      return;
    }

    let cancelled = false;
    const recoveryId = window.setTimeout(() => {
      if (currentQuestionId === null) {
        recoveredVoteQuestionId.current = null;
        setSavedOptionId(null);
        setVoteStatus('idle');
        setVoteError(null);
        return;
      }

      if (recoveredVoteQuestionId.current === currentQuestionId) {
        return;
      }

      recoveredVoteQuestionId.current = currentQuestionId;
      setSavedOptionId(null);
      setVoteStatus('recovering');
      setVoteError(null);

      void supabase
        .rpc('get_my_current_vote', { p_code: code })
        .then(
          (currentVoteResult: {
            data: unknown;
            error: SupabaseErrorLike | null;
          }) => {
            if (cancelled) {
              return;
            }

            if (currentVoteResult.error) {
              setVoteStatus('error');
              setVoteError(getVoteErrorMessage(currentVoteResult.error));
              return;
            }

            if (
              currentVoteResult.data === null ||
              typeof currentVoteResult.data === 'string'
            ) {
              setSavedOptionId(currentVoteResult.data);
              setVoteStatus(currentVoteResult.data === null ? 'idle' : 'saved');
              return;
            }

            setVoteStatus('error');
            setVoteError('Impossibile recuperare il voto registrato. Riprova.');
          },
        );
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(recoveryId);
    };
  }, [code, currentQuestionId, player, supabase]);

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
      <main className='grid min-h-screen place-items-center bg-slate-950 p-6 text-white'>
        <p className='text-sm font-medium text-slate-300'>
          Recupero della tua partecipazione…
        </p>
      </main>
    );
  }

  if (playerError || error || !player || !snapshot) {
    return (
      <main className='grid min-h-screen place-items-center bg-slate-950 p-6 text-white'>
        <section className='w-full max-w-md rounded-2xl bg-white/5 p-6 text-center shadow-2xl ring-1 ring-white/10'>
          <h1 className='text-2xl font-bold text-white'>Lobby non disponibile</h1>
          <p className='mt-3 text-sm text-slate-300'>
            {playerError ?? error ?? 'Impossibile caricare la stanza.'}
          </p>
          <Link
            className='mt-6 inline-flex rounded-xl bg-indigo-500 px-5 py-3 font-semibold text-white hover:bg-indigo-400 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-300/40'
            href={`/join/${code}`}
          >
            Torna all’ingresso
          </Link>
        </section>
      </main>
    );
  }

  if (snapshot.mode === 'exam' && snapshot.phase !== 'lobby') {
    return <ExamPlayer code={code} player={player} />;
  }

  const ownLeaderboardEntry = snapshot.leaderboard.find(
    (entry) =>
      entry.nickname === player.nickname && entry.avatarKey === player.avatarKey,
  );

  if (snapshot.phase === 'voting_open' && snapshot.currentQuestion) {
    const question = snapshot.currentQuestion;
    const mostlyVisual =
      question.options.filter((option) => option.media !== null).length >= 3;

    return (
      <main className='min-h-screen overflow-x-hidden bg-slate-950 px-4 py-6 text-white'>
        <div className='mx-auto max-w-lg'>
          <header className='flex items-center justify-between gap-3'>
            <div className='flex min-w-0 items-center gap-3'>
              <AvatarBadge avatarKey={player.avatarKey} size='sm' />
              <div className='min-w-0'>
                <p className='truncate font-bold text-white'>{player.nickname}</p>
                <p className='text-xs font-semibold text-indigo-300'>
                  Domanda {(snapshot.currentQuestionIndex ?? 0) + 1} /{' '}
                  {snapshot.totalQuestionCount}
                </p>
                <p className='text-xs font-bold text-slate-400'>
                  {ownLeaderboardEntry?.score ?? 0} punti
                </p>
              </div>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                connectionStatus === 'connected'
                  ? 'bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-300/25'
                  : 'bg-amber-400/15 text-amber-200 ring-1 ring-amber-300/25'
              }`}
            >
              {CONNECTION_LABELS[connectionStatus]}
            </span>
          </header>

          <section className='mt-6 rounded-3xl bg-white/5 p-5 shadow-2xl ring-1 ring-white/10 sm:p-7'>
            <p className='text-sm font-bold uppercase tracking-wide text-indigo-300'>
              {question.category}
            </p>
            {question.prompt ? (
              <h1 className='mt-3 break-words text-2xl font-black leading-tight text-white'>
                {question.prompt}
              </h1>
            ) : null}
            {question.media ? (
              <QuizMediaImage
                priority
                className='mt-5 max-h-[42vh]'
                media={question.media}
                sizes='(min-width: 640px) 32rem, calc(100vw - 3rem)'
              />
            ) : null}

            <div className={`mt-6 grid gap-3 ${mostlyVisual ? 'sm:grid-cols-2' : ''}`}>
              {question.options.map((option) => {
                const selected = savedOptionId === option.id;

                return (
                  <button
                    aria-pressed={selected}
                    className={`min-h-16 rounded-2xl px-4 py-3 text-left font-bold ring-2 transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-300 disabled:cursor-wait disabled:opacity-50 ${
                      selected
                        ? 'bg-indigo-500 text-white ring-indigo-300'
                        : 'bg-white/5 text-slate-100 ring-white/15 hover:bg-white/10 hover:ring-indigo-400/60'
                    }`}
                    key={option.id}
                    type='button'
                    onClick={() => void submitVote(option.id)}
                    disabled={
                      voteStatus === 'submitting' || voteStatus === 'recovering'
                    }
                  >
                    <span className='block text-sm font-black text-indigo-200'>
                      {getAnswerPositionLabel(option.position)}
                    </span>
                    {option.media ? (
                      <QuizMediaImage
                        className='mt-2 min-h-32 max-h-64'
                        media={option.media}
                        sizes={mostlyVisual ? '(min-width: 640px) 15rem, calc(100vw - 4rem)' : '(min-width: 640px) 30rem, calc(100vw - 4rem)'}
                      />
                    ) : null}
                    {option.text ? (
                      <span className='mt-2 block break-words'>{option.text}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            <p
              className={`mt-5 rounded-xl px-4 py-3 text-center text-sm font-medium ${
                voteStatus === 'error'
                  ? 'bg-red-500/15 text-red-200 ring-1 ring-red-400/30'
                  : voteStatus === 'saved'
                    ? 'bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-300/30'
                    : 'bg-amber-400/15 text-amber-200 ring-1 ring-amber-300/30'
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
      <main className='min-h-screen overflow-x-hidden bg-slate-950 px-4 py-6 text-white'>
        <div className='mx-auto max-w-lg'>
          <header className='flex items-center justify-between gap-3'>
            <div className='flex min-w-0 items-center gap-3'>
              <AvatarBadge avatarKey={player.avatarKey} size='sm' />
              <div className='min-w-0'>
                <p className='truncate font-bold text-white'>{player.nickname}</p>
                <p className='text-xs font-semibold text-emerald-300'>
                  Risposta rivelata · Domanda {snapshot.currentQuestionIndex + 1}
                </p>
              </div>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                connectionStatus === 'connected'
                  ? 'bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-300/25'
                  : 'bg-amber-400/15 text-amber-200 ring-1 ring-amber-300/25'
              }`}
            >
              {CONNECTION_LABELS[connectionStatus]}
            </span>
          </header>

          <section className='mt-6 rounded-3xl bg-white/5 p-5 shadow-2xl ring-1 ring-white/10 sm:p-7'>
            <p className='text-sm font-bold uppercase tracking-wide text-emerald-300'>
              {question.category}
            </p>
            {question.prompt ? (
              <h1 className='mt-3 break-words text-2xl font-black leading-tight text-white'>
                {question.prompt}
              </h1>
            ) : null}
            {question.media ? (
              <QuizMediaImage
                priority
                className='mt-5 max-h-[42vh]'
                media={question.media}
                sizes='(min-width: 640px) 32rem, calc(100vw - 3rem)'
              />
            ) : null}

            <ol className='mt-6 grid gap-3'>
              {question.options.map((option) => {
                const selected = option.id === savedOptionId;

                return (
                  <li
                    className={`rounded-2xl px-4 py-3 font-bold ring-2 ${
                      option.isCorrect
                        ? 'bg-emerald-400/20 text-emerald-50 ring-emerald-400'
                        : selected
                          ? 'bg-red-500/20 text-red-50 ring-red-400'
                          : 'bg-white/5 text-slate-300 ring-white/10'
                    }`}
                    key={option.id}
                  >
                    <div className='flex items-center justify-between gap-3'>
                      <span>
                        {getAnswerPositionLabel(option.position)}
                        {option.text ? `. ${option.text}` : ''}
                      </span>
                      <span className='text-xs font-black uppercase tracking-wide'>
                        {option.isCorrect
                          ? 'Corretta'
                          : selected
                            ? 'La tua scelta'
                            : ''}
                      </span>
                    </div>
                    {option.media ? (
                      <QuizMediaImage
                        className='mt-3 max-h-64'
                        media={option.media}
                        sizes='(min-width: 640px) 30rem, calc(100vw - 4rem)'
                      />
                    ) : null}
                  </li>
                );
              })}
            </ol>

            <div
              className={`mt-6 rounded-2xl px-5 py-4 text-center ${
                savedOptionId === null
                  ? 'bg-amber-400/15 text-amber-100 ring-1 ring-amber-300/30'
                  : answeredCorrectly
                    ? 'bg-emerald-400/15 text-emerald-100 ring-1 ring-emerald-300/30'
                    : 'bg-red-500/15 text-red-100 ring-1 ring-red-400/30'
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
                  ? correctOption.text
                    ? `${getAnswerPositionLabel(correctOption.position)}. ${correctOption.text}`
                    : `l’opzione ${getAnswerPositionLabel(correctOption.position)}`
                  : 'non disponibile'}
                {selectedOption && !answeredCorrectly
                  ? ` La tua scelta era ${getAnswerPositionLabel(selectedOption.position)}.`
                  : ''}
              </p>
              <p className='mt-3 text-base font-black'>
                +{ownLeaderboardEntry?.currentPoints ?? 0} punti · Totale{' '}
                {ownLeaderboardEntry?.score ?? 0}
              </p>
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (snapshot.phase === 'finished') {
    const finalRank = ownLeaderboardEntry?.rank ?? snapshot.participantCount;
    const finalScore = ownLeaderboardEntry?.score ?? 0;
    const highestScore = snapshot.leaderboard[0]?.score ?? 0;
    const lowestScore = snapshot.leaderboard.at(-1)?.score ?? 0;
    const finalComment = getFinalResultComment({
      rank: finalRank,
      participantCount: snapshot.participantCount,
      score: finalScore,
      isTied: isRankTied(snapshot.leaderboard, finalRank),
      highestScore,
      isLast: finalScore === lowestScore,
      nickname: player.nickname,
      code: snapshot.code,
    });

    return (
      <main className='min-h-screen overflow-x-hidden bg-slate-950 px-4 py-7 text-white'>
        <div className='mx-auto max-w-lg'>
          <header className='rounded-3xl bg-white/5 p-6 text-center shadow-2xl ring-1 ring-white/10'>
            <AvatarBadge avatarKey={player.avatarKey} size='lg' />
            <p className='mt-4 text-sm font-bold uppercase tracking-wide text-indigo-300'>
              Quiz terminato
            </p>
            <h1 className='mt-2 break-words text-3xl font-black text-white'>
              {player.nickname}
            </h1>
            <p className='mt-4 text-4xl font-black text-indigo-200'>
              {formatCompetitionRank(finalRank)}
            </p>
            <p className='mt-1 text-sm font-semibold text-slate-400'>
              su {snapshot.participantCount} partecipanti
            </p>
            <p className='mt-4 text-2xl font-black text-white'>{finalScore} punti</p>
            <p className='mt-5 rounded-2xl bg-indigo-400/15 px-5 py-4 text-base font-bold leading-relaxed text-indigo-100 ring-1 ring-indigo-300/30'>
              {finalComment}
            </p>
          </header>
          <div className='mt-7'>
            <Leaderboard
              dark
              entries={snapshot.leaderboard}
              title='Classifica completa'
              highlightedPlayer={player}
            />
          </div>
        </div>
      </main>
    );
  }

  if (snapshot.phase === 'voting_closed') {
    return (
      <main className='grid min-h-screen place-items-center bg-slate-950 p-6 text-white'>
        <section className='w-full max-w-md rounded-3xl bg-white/5 p-7 text-center shadow-2xl ring-1 ring-white/10'>
          <AvatarBadge avatarKey={player.avatarKey} size='lg' />
          <h1 className='mt-4 text-2xl font-black text-white'>
            Votazione chiusa
          </h1>
          <p className='mt-3 text-sm text-slate-300'>
            La tua risposta non può più essere modificata. Attendi che l’host mostri la soluzione.
          </p>
          {savedOptionId ? (
            <p className='mt-5 rounded-xl bg-indigo-400/15 px-4 py-3 font-semibold text-indigo-100 ring-1 ring-indigo-300/30'>
              Voto registrato
            </p>
          ) : null}
        </section>
      </main>
    );
  }

  const waiting = snapshot.phase === 'lobby';

  return (
    <main className='min-h-screen overflow-x-hidden bg-slate-950 px-4 py-8 text-white'>
      <div className='mx-auto max-w-lg'>
        <header className='flex items-center justify-between gap-3'>
          <p className='text-sm font-bold uppercase tracking-wide text-indigo-300'>
            Stanza {snapshot.code}
          </p>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              connectionStatus === 'connected'
                ? 'bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-300/25'
                : 'bg-amber-400/15 text-amber-200 ring-1 ring-amber-300/25'
            }`}
          >
            {CONNECTION_LABELS[connectionStatus]}
          </span>
        </header>

        <section className='mt-6 rounded-3xl bg-white/5 p-6 text-center shadow-2xl ring-1 ring-white/10'>
          <AvatarBadge avatarKey={player.avatarKey} size='lg' />
          <h1 className='mt-4 break-words text-3xl font-black text-white'>
            {player.nickname}
          </h1>
          <p className='mt-1 text-sm text-slate-400'>{snapshot.quizTitle}</p>

          <div
            className={`mt-7 rounded-2xl px-5 py-6 ${
              waiting
                ? 'bg-indigo-400/15 text-indigo-100 ring-1 ring-indigo-300/30'
                : 'bg-amber-400/15 text-amber-100 ring-1 ring-amber-300/30'
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

          <p className='mt-5 text-sm font-medium text-slate-300'>
            Giocatori: {snapshot.participantCount} / {snapshot.maxPlayers}
          </p>
        </section>
      </div>
    </main>
  );
}
