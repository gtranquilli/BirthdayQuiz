'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { useLobbySession } from '@/features/lobby/use-lobby-session';
import { normalizeGameCode } from '@/lib/game/lobby';
import { recoverParticipant } from '@/lib/game/participant-recovery';
import { createClient } from '@/lib/supabase/client';

import { JoinGameForm } from './join-game-form';

interface JoinGameScreenProps {
  readonly code: string;
  readonly recoveryFailed?: boolean;
}

type RecoveryStatus = 'checking' | 'unavailable' | 'failed' | 'error' | 'recovered';

export function JoinGameScreen({
  code: rawCode,
  recoveryFailed = false,
}: JoinGameScreenProps) {
  const code = normalizeGameCode(rawCode);
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { snapshot, loading, error, refresh } = useLobbySession(code);
  const [recoveryStatus, setRecoveryStatus] =
    useState<RecoveryStatus>('checking');
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let redirectId: number | undefined;
    const recoveryId = window.setTimeout(() => {
      void recoverParticipant(supabase, code)
        .then((result) => {
          if (cancelled) {
            return;
          }

          if (result.status === 'recovered') {
            setRecoveryStatus('recovered');
            redirectId = window.setTimeout(() => {
              router.replace(`/play/${code}`);
            }, 500);
            return;
          }

          setRecoveryStatus(
            result.reason === 'invalid' || recoveryFailed
              ? 'failed'
              : 'unavailable',
          );
        })
        .catch(() => {
          if (!cancelled) {
            setRecoveryError(
              'Impossibile verificare la partecipazione. Controlla la connessione e riprova.',
            );
            setRecoveryStatus('error');
          }
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(recoveryId);
      if (redirectId !== undefined) {
        window.clearTimeout(redirectId);
      }
    };
  }, [code, recoveryAttempt, recoveryFailed, router, supabase]);

  if (recoveryStatus === 'checking' || recoveryStatus === 'recovered') {
    return (
      <main className='grid min-h-screen place-items-center bg-slate-950 p-6 text-white'>
        <p className='text-sm font-semibold text-slate-300'>
          {recoveryStatus === 'recovered'
            ? 'Partecipazione recuperata.'
            : 'Recupero della tua partecipazione…'}
        </p>
      </main>
    );
  }

  if (recoveryStatus === 'error') {
    return (
      <main className='grid min-h-screen place-items-center bg-slate-950 p-5 text-white'>
        <section className='w-full max-w-md rounded-3xl bg-white/5 p-6 text-center shadow-2xl ring-1 ring-white/10'>
          <h1 className='text-2xl font-black text-white'>Recupero non disponibile</h1>
          <p className='mt-3 text-sm text-slate-300'>{recoveryError}</p>
          <button
            className='mt-6 min-h-12 rounded-xl bg-indigo-500 px-5 py-3 font-bold text-white hover:bg-indigo-400 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-300/40'
            type='button'
            onClick={() => {
              setRecoveryError(null);
              setRecoveryStatus('checking');
              setRecoveryAttempt((attempt) => attempt + 1);
            }}
          >
            Riprova
          </button>
        </section>
      </main>
    );
  }

  if (loading) {
    return (
      <main className='grid min-h-screen place-items-center bg-slate-950 p-6 text-white'>
        <p className='text-sm font-semibold text-slate-300'>Verifica stanza…</p>
      </main>
    );
  }

  if (error || !snapshot) {
    return (
      <main className='grid min-h-screen place-items-center bg-slate-950 p-5 text-white'>
        <section className='w-full max-w-md rounded-3xl bg-white/5 p-6 text-center shadow-2xl ring-1 ring-white/10'>
          <h1 className='text-2xl font-black text-white'>Stanza non disponibile</h1>
          <p className='mt-3 text-sm text-slate-300'>
            {error ?? 'Controlla il link e riprova.'}
          </p>
          <div className='mt-6 flex flex-col gap-3'>
            <button
              className='min-h-12 rounded-xl bg-indigo-500 px-5 py-3 font-bold text-white hover:bg-indigo-400 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-300/40'
              type='button'
              onClick={() => void refresh()}
            >
              Riprova
            </button>
            <Link className='py-2 font-semibold text-indigo-300 hover:text-indigo-200' href='/'>
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
      <main className='grid min-h-screen place-items-center bg-slate-950 p-5 text-white'>
        <section className='w-full max-w-md rounded-3xl bg-white/5 p-6 text-center shadow-2xl ring-1 ring-white/10'>
          <p className='text-sm font-bold uppercase tracking-wide text-indigo-300'>
            Stanza {snapshot.code}
          </p>
          <h1 className='mt-2 text-2xl font-black text-white'>
            {lobbyClosed ? 'La partita è già iniziata' : 'La stanza è piena'}
          </h1>
          <p className='mt-3 text-sm text-slate-300'>
            {lobbyClosed
              ? 'Non è più possibile aggiungere nuovi partecipanti.'
              : `Sono già entrati ${snapshot.participantCount} giocatori su ${snapshot.maxPlayers}.`}
          </p>
          {recoveryStatus === 'failed' ? (
            <p className='mt-4 rounded-xl bg-amber-400/15 px-4 py-3 text-sm font-semibold text-amber-200 ring-1 ring-amber-300/30'>
              Non è stato possibile recuperare la partecipazione precedente.
            </p>
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <main className='min-h-screen overflow-x-hidden bg-slate-950 px-4 py-5 text-white sm:grid sm:place-items-center sm:py-10'>
      <section className='mx-auto w-full max-w-xl rounded-3xl bg-white/5 p-5 shadow-2xl shadow-black/30 ring-1 ring-white/10 sm:p-8'>
        <p className='text-sm font-bold uppercase tracking-wide text-indigo-300'>
          Stanza {snapshot.code}
        </p>
        <h1 className='mt-2 break-words text-3xl font-black leading-tight text-white'>
          {snapshot.quizTitle}
        </h1>
        <p className='mt-2 text-sm text-slate-300'>
          Scegli nickname e avatar. Al resto pensiamo noi.
        </p>
        {recoveryStatus === 'failed' ? (
          <p className='mt-4 rounded-xl bg-amber-400/15 px-4 py-3 text-sm font-semibold text-amber-200 ring-1 ring-amber-300/30'>
            Non è stato possibile recuperare la partecipazione precedente.
          </p>
        ) : null}
        <div className='mt-6'>
          <JoinGameForm code={snapshot.code} />
        </div>
      </section>
    </main>
  );
}
