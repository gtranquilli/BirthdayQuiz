'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AvatarBadge } from '@/components/avatar-badge';
import { useLobbySession } from '@/features/lobby/use-lobby-session';
import { parseExamProgress, type ExamProgress } from '@/lib/game/exam';
import { ExamResults } from './exam-results';

interface HostExamPlayer {
  playerId: string;
  nickname: string;
  avatarKey: string;
  completedCount: number;
  submittedAt: string | null;
  points: number | null;
}
export function ExamHost({ code }: { readonly code: string }) {
  const { snapshot, connectionStatus, refresh } = useLobbySession(code);
  const [players, setPlayers] = useState<HostExamPlayer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExamProgress | null>(null);
  const [selectedName, setSelectedName] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/host/game-sessions/${code}/exam`, {
        cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? 'Impossibile caricare i progressi.');
      setPlayers(body.players as HostExamPlayer[]);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Connessione non disponibile.',
      );
    } finally {
      setLoading(false);
    }
  }, [code]);
  useEffect(() => {
    const id = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(id);
  }, [load, snapshot]);
  async function showResult(player: HostExamPlayer) {
    setResult(null);
    setSelectedName(player.nickname);
    try {
      const response = await fetch(
        `/api/host/game-sessions/${code}/exam?playerId=${player.playerId}`,
        { cache: 'no-store' },
      );
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? 'Risultato non disponibile.');
      const parsed = parseExamProgress(body.progress);
      if (!parsed?.result) throw new Error('Risultato non disponibile.');
      setResult(parsed);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Connessione non disponibile.',
      );
    }
  }
  return (
    <main className='min-h-screen overflow-x-hidden bg-slate-950 px-4 py-8 text-white'>
      <div className='mx-auto max-w-4xl space-y-6'>
        <Link className='text-indigo-300' href='/host'>
          ← Tutte le stanze
        </Link>
        <header>
          <p className='text-indigo-300'>Esame · {code}</p>
          <h1 className='mt-2 break-words text-3xl font-black'>
            {snapshot?.quizTitle}
          </h1>
          <p className='mt-2 text-slate-300'>
            {snapshot?.phase === 'finished'
              ? 'Esame concluso: tutti hanno consegnato.'
              : 'Esame in corso: ogni partecipante avanza autonomamente.'}
          </p>
          <p className='mt-2 text-sm text-slate-400'>
            {connectionStatus === 'connected'
              ? 'Sincronizzato'
              : 'Riconnessione…'}
          </p>
        </header>
        <div className='flex flex-wrap gap-4'>
          <a
            className='text-indigo-300 underline'
            href={`/display/${code}`}
            target='_blank'
            rel='noreferrer'
          >
            Apri display
          </a>
          <button
            className='text-indigo-300 underline'
            onClick={() => {
              void load();
              void refresh();
            }}
          >
            Aggiorna progressi
          </button>
        </div>
        {error && (
          <p role='alert' className='rounded-xl bg-red-500/15 p-4 text-red-200'>
            {error}
          </p>
        )}
        {loading && <p>Caricamento progressi…</p>}
        <ul className='space-y-3'>
          {players.map((p) => (
            <li
              className='flex flex-wrap items-center gap-4 rounded-2xl bg-white/5 p-4'
              key={p.playerId}
            >
              <AvatarBadge avatarKey={p.avatarKey} size='sm' />
              <div className='min-w-0 flex-1'>
                <p className='break-words font-bold'>{p.nickname}</p>
                <p className='text-sm text-slate-300'>
                  {p.completedCount}/{snapshot?.totalQuestionCount} risposte ·{' '}
                  {p.submittedAt ? 'Consegnato' : 'In corso'}
                </p>
              </div>
              {p.submittedAt && (
                <button
                  className='min-h-12 rounded-xl border border-indigo-300 px-4 text-indigo-200'
                  onClick={() => void showResult(p)}
                >
                  {p.points} punti · Correzione
                </button>
              )}
            </li>
          ))}
        </ul>
        {result && (
          <section className='border-t border-white/20 pt-6'>
            <div className='mb-6 flex items-center justify-between gap-3'>
              <h2 className='text-xl font-bold'>Risultato di {selectedName}</h2>
              <button onClick={() => setResult(null)}>Chiudi</button>
            </div>
            <ExamResults progress={result} />
          </section>
        )}
      </div>
    </main>
  );
}
