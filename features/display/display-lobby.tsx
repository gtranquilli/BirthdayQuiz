'use client';

import { AvatarBadge } from '@/components/avatar-badge';
import { normalizeGameCode } from '@/lib/game/lobby';
import { useLobbySession } from '@/features/lobby/use-lobby-session';
import { getAnswerPositionLabel } from '@/lib/game/answer-position';

interface DisplayLobbyProps {
  readonly code: string;
}

export function DisplayLobby({ code: rawCode }: DisplayLobbyProps) {
  const code = normalizeGameCode(rawCode);
  const { snapshot, loading, error, connectionStatus, refresh } =
    useLobbySession(code);

  if (loading) {
    return (
      <main className='grid min-h-screen place-items-center bg-slate-950 p-10 text-white'>
        <p className='text-xl font-semibold text-slate-300'>Caricamento lobby…</p>
      </main>
    );
  }

  if (error || !snapshot) {
    return (
      <main className='grid min-h-screen place-items-center bg-slate-950 p-10 text-white'>
        <section className='max-w-xl text-center'>
          <h1 className='text-4xl font-black'>Lobby non disponibile</h1>
          <p className='mt-4 text-lg text-slate-300'>
            {error ?? 'Impossibile caricare la stanza.'}
          </p>
          <button
            className='mt-7 rounded-xl bg-white px-6 py-3 font-bold text-slate-950 hover:bg-slate-200'
            type='button'
            onClick={() => void refresh()}
          >
            Riprova
          </button>
        </section>
      </main>
    );
  }

  if (snapshot.phase === 'voting_open' && snapshot.currentQuestion) {
    const question = snapshot.currentQuestion;

    return (
      <main className='min-h-screen bg-slate-950 px-8 py-7 text-white lg:px-14 lg:py-10'>
        <div className='mx-auto flex min-h-[calc(100vh-5rem)] max-w-7xl flex-col'>
          <header className='flex items-start justify-between gap-8'>
            <div>
              <p className='text-sm font-bold uppercase tracking-[0.3em] text-indigo-300'>
                {question.category}
              </p>
              <p className='mt-2 text-xl font-bold text-slate-300'>
                Domanda {(snapshot.currentQuestionIndex ?? 0) + 1} /{' '}
                {snapshot.totalQuestionCount}
              </p>
            </div>
            <span
              className={`rounded-full px-4 py-2 text-sm font-bold ${
                connectionStatus === 'connected'
                  ? 'bg-emerald-400/15 text-emerald-300'
                  : 'bg-amber-400/15 text-amber-200'
              }`}
            >
              {connectionStatus === 'connected' ? 'In tempo reale' : 'Riconnessione…'}
            </span>
          </header>

          <section className='my-auto py-8'>
            <h1 className='mx-auto max-w-5xl text-center text-4xl font-black leading-tight lg:text-6xl'>
              {question.prompt}
            </h1>
            <ol className='mx-auto mt-10 grid max-w-6xl gap-5 md:grid-cols-2'>
              {question.options.map((option) => (
                <li
                  className='flex min-h-28 items-center rounded-3xl bg-white/10 px-7 py-5 text-2xl font-bold ring-1 ring-white/15 lg:text-3xl'
                  key={option.id}
                >
                  <span className='mr-5 grid size-11 shrink-0 place-items-center rounded-full bg-indigo-500 text-lg'>
                    {getAnswerPositionLabel(option.position)}
                  </span>
                  {option.text}
                </li>
              ))}
            </ol>
          </section>

          <footer className='flex items-center justify-between gap-6 border-t border-white/10 pt-5'>
            <p className='text-sm font-bold uppercase tracking-[0.2em] text-slate-400'>
              Stanza {snapshot.code}
            </p>
            <p className='text-2xl font-black'>
              Voti {snapshot.votedCount} / {snapshot.participantCount}
            </p>
          </footer>
        </div>
      </main>
    );
  }

  return (
    <main className='min-h-screen bg-slate-950 px-8 py-7 text-white lg:px-14 lg:py-10'>
      <div className='mx-auto flex min-h-[calc(100vh-5rem)] max-w-7xl flex-col'>
        <header className='flex items-start justify-between gap-8'>
          <div>
            <p className='text-sm font-bold uppercase tracking-[0.3em] text-indigo-300'>
              Quiz Engine
            </p>
            <h1 className='mt-2 text-3xl font-black lg:text-5xl'>
              {snapshot.quizTitle}
            </h1>
          </div>
          <span
            className={`rounded-full px-4 py-2 text-sm font-bold ${
              connectionStatus === 'connected'
                ? 'bg-emerald-400/15 text-emerald-300'
                : 'bg-amber-400/15 text-amber-200'
            }`}
          >
            {connectionStatus === 'connected'
              ? 'In tempo reale'
              : connectionStatus === 'offline'
                ? 'Offline'
                : 'Riconnessione…'}
          </span>
        </header>

        <section className='mt-8 grid flex-1 gap-8 lg:grid-cols-[minmax(20rem,0.8fr)_1.5fr]'>
          <div className='flex flex-col justify-center rounded-3xl bg-indigo-600 p-8 text-center shadow-2xl shadow-indigo-950/40'>
            <p className='text-lg font-bold uppercase tracking-[0.2em] text-indigo-100'>
              Codice stanza
            </p>
            <p className='mt-5 text-6xl font-black tracking-[0.18em] sm:text-7xl lg:text-8xl'>
              {snapshot.code}
            </p>
            <p className='mt-7 text-2xl font-bold text-indigo-50'>
              {snapshot.participantCount} / {snapshot.maxPlayers} giocatori
            </p>
            <p className='mt-3 text-indigo-200'>
              Apri questa app sul telefono e inserisci il codice.
            </p>
          </div>

          <div className='rounded-3xl bg-white/5 p-7 ring-1 ring-white/10'>
            <div className='flex items-center justify-between gap-4'>
              <h2 className='text-2xl font-black'>Giocatori in lobby</h2>
              <span className='text-sm font-semibold text-slate-400'>
                {snapshot.phase === 'lobby' ? 'In attesa dell’host' : 'Partita iniziata'}
              </span>
            </div>

            {snapshot.players.length === 0 ? (
              <div className='grid min-h-64 place-items-center text-center text-slate-400'>
                <p>Nessun giocatore è ancora entrato.</p>
              </div>
            ) : (
              <ul className='mt-7 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4'>
                {snapshot.players.map((player) => (
                  <li
                    className='flex min-w-0 flex-col items-center rounded-2xl bg-white/10 p-4 text-center'
                    key={`${player.nickname}:${player.avatarKey}`}
                  >
                    <AvatarBadge avatarKey={player.avatarKey} size='md' />
                    <span className='mt-3 w-full truncate font-bold'>
                      {player.nickname}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
