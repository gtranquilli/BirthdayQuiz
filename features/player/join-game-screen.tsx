'use client';

import Link from 'next/link';

import { useLobbySession } from '@/features/lobby/use-lobby-session';
import { normalizeGameCode } from '@/lib/game/lobby';

import { JoinGameForm } from './join-game-form';

interface JoinGameScreenProps {
  readonly code: string;
}

export function JoinGameScreen({ code: rawCode }: JoinGameScreenProps) {
  const code = normalizeGameCode(rawCode);
  const { snapshot, loading, error, refresh } = useLobbySession(code);

  if (loading) {
    return (
      <main className='grid min-h-screen place-items-center bg-slate-100 p-6'>
        <p className='text-sm font-semibold text-slate-600'>Verifica stanza…</p>
      </main>
    );
  }

  if (error || !snapshot) {
    return (
      <main className='grid min-h-screen place-items-center bg-slate-100 p-5'>
        <section className='w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200'>
          <h1 className='text-2xl font-black text-slate-950'>Stanza non disponibile</h1>
          <p className='mt-3 text-sm text-slate-600'>
            {error ?? 'Controlla il link e riprova.'}
          </p>
          <div className='mt-6 flex flex-col gap-3'>
            <button
              className='min-h-12 rounded-xl bg-indigo-600 px-5 py-3 font-bold text-white'
              type='button'
              onClick={() => void refresh()}
            >
              Riprova
            </button>
            <Link className='py-2 font-semibold text-indigo-700' href='/'>
              Inserisci il codice manualmente
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const lobbyClosed = snapshot.phase !== 'lobby';
  const roomFull = snapshot.participantCount >= snapshot.maxPlayers;

  if (lobbyClosed || roomFull) {
    return (
      <main className='grid min-h-screen place-items-center bg-slate-100 p-5'>
        <section className='w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200'>
          <p className='text-sm font-bold uppercase tracking-wide text-indigo-700'>
            Stanza {snapshot.code}
          </p>
          <h1 className='mt-2 text-2xl font-black text-slate-950'>
            {lobbyClosed ? 'La partita è già iniziata' : 'La stanza è piena'}
          </h1>
          <p className='mt-3 text-sm text-slate-600'>
            {lobbyClosed
              ? 'Non è più possibile aggiungere nuovi partecipanti.'
              : `Sono già entrati ${snapshot.participantCount} giocatori su ${snapshot.maxPlayers}.`}
          </p>
          <Link
            className='mt-6 inline-flex min-h-12 items-center justify-center rounded-xl bg-indigo-600 px-5 py-3 font-bold text-white'
            href={`/play/${snapshot.code}`}
          >
            Ero già entrato
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className='min-h-screen overflow-x-hidden bg-slate-100 px-4 py-5 sm:grid sm:place-items-center sm:py-10'>
      <section className='mx-auto w-full max-w-xl rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-8'>
        <p className='text-sm font-bold uppercase tracking-wide text-indigo-700'>
          Stanza {snapshot.code}
        </p>
        <h1 className='mt-2 text-3xl font-black leading-tight text-slate-950'>
          {snapshot.quizTitle}
        </h1>
        <p className='mt-2 text-sm text-slate-600'>
          Scegli nickname e avatar. Al resto pensiamo noi.
        </p>
        <div className='mt-6'>
          <JoinGameForm code={snapshot.code} />
        </div>
      </section>
    </main>
  );
}
