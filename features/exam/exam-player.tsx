'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AvatarBadge } from '@/components/avatar-badge';
import { QuizMediaImage } from '@/components/quiz-media-image';
import { getAnswerPositionLabel } from '@/lib/game/answer-position';
import {
  examError,
  parseExamProgress,
  type ExamProgress,
} from '@/lib/game/exam';
import type { StoredPlayerEntry } from '@/lib/game/lobby';
import { recoverParticipant } from '@/lib/game/participant-recovery';
import { createClient } from '@/lib/supabase/client';
import { ExamResults } from './exam-results';

const button =
  'min-h-12 rounded-xl border border-white/20 px-4 py-3 font-semibold focus-visible:outline-2 focus-visible:outline-indigo-300 disabled:opacity-40';
export function ExamPlayer({
  code,
  player,
}: {
  readonly code: string;
  readonly player: StoredPlayerEntry;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [progress, setProgress] = useState<ExamProgress | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const inFlight = useRef(false);

  const accept = useCallback((data: unknown) => {
    const next = parseExamProgress(data);
    if (!next) throw new Error('Progresso non disponibile. Riprova.');
    setProgress(next);
    setDraft(next.questions[next.lastIndex]?.selectedOptionId ?? null);
    return next;
  }, []);

  const recover = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      if (!navigator.onLine)
        throw new Error(
          'Sei offline. Riconnettiti per recuperare il progresso.',
        );
      const recovered = await recoverParticipant(supabase, code);
      if (recovered.status !== 'recovered')
        throw new Error(
          'Partecipazione non recuperabile. Torna all’ingresso della stanza.',
        );
      const { data, error } = await supabase.rpc('get_my_exam_progress', {
        p_code: code,
      });
      if (error) throw new Error(examError(error.code));
      accept(data);
      setError(null);
      setConfirming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : examError());
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [accept, code, supabase]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setOffline(!navigator.onLine);
      void recover();
    }, 0);
    const online = () => {
      setOffline(false);
      void recover();
    };
    const offline = () => setOffline(true);
    const visible = () => {
      if (document.visibilityState === 'visible') void recover();
    };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    window.addEventListener('pageshow', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      window.removeEventListener('pageshow', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [recover]);

  const question = progress?.questions[progress.lastIndex];
  const dirty = !!question && draft !== question.selectedOptionId;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function save(index: number, confirmAnswer: boolean) {
    if (!progress || !question || inFlight.current || offline) return;
    if (
      !confirmAnswer &&
      dirty &&
      !window.confirm(
        'La scelta non è confermata. Cambiare domanda senza salvarla?',
      )
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const { data, error } = await supabase.rpc('save_exam_progress', {
        p_code: code,
        p_last_index: index,
        p_game_question_id: confirmAnswer ? question.id : null,
        p_game_answer_option_id: confirmAnswer ? draft : null,
      });
      if (error) throw new Error(examError(error.code));
      accept(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : examError());
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function submit() {
    if (!confirming || inFlight.current || offline) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const { data, error } = await supabase.rpc('submit_exam', {
        p_code: code,
      });
      if (error) throw new Error(examError(error.code));
      accept(data);
      setConfirming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : examError());
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <main className='min-h-screen overflow-x-hidden bg-slate-950 px-4 py-6 text-white'>
      <div className='mx-auto max-w-2xl space-y-6'>
        <header className='flex items-center gap-3'>
          <AvatarBadge avatarKey={player.avatarKey} size='sm' />
          <div className='min-w-0 flex-1'>
            <p className='truncate font-bold'>{player.nickname}</p>
            <p className='text-sm text-indigo-300'>Esame · {code}</p>
          </div>
          <span role='status' className='text-sm text-slate-300'>
            {offline ? 'Offline' : busy ? 'Sincronizzazione…' : 'Online'}
          </span>
        </header>
        {offline && (
          <p
            role='status'
            className='rounded-xl bg-amber-500/15 p-4 text-amber-200'
          >
            Sei offline. Le risposte già confermate sono conservate; attendi la
            connessione per salvare.
          </p>
        )}
        {error && (
          <div
            role='alert'
            className='rounded-xl bg-red-500/15 p-4 text-red-200'
          >
            <p>{error}</p>
            <button
              className={button + ' mt-3'}
              disabled={busy || offline}
              onClick={() => void recover()}
            >
              Recupera progresso dal server
            </button>
          </div>
        )}
        {!progress && !error && <p>Caricamento esame…</p>}
        {progress?.result ? (
          <ExamResults progress={progress} />
        ) : progress && question ? (
          <>
            <section aria-label='Avanzamento'>
              <p className='mb-2 font-semibold'>
                {progress.completedCount} / {progress.questions.length} risposte
                confermate
              </p>
              <progress
                className='h-3 w-full accent-indigo-400'
                max={progress.questions.length}
                value={progress.completedCount}
              />
              <p className='mt-2 text-sm text-slate-400'>
                ✓ Confermata · ○ Mancante. La scelta diventa salvata solo con
                Conferma.
              </p>
              <nav
                aria-label='Domande'
                className='mt-4 grid grid-cols-5 gap-2 sm:grid-cols-8'
              >
                {progress.questions.map((q, i) => (
                  <button
                    key={q.id}
                    disabled={busy || offline || confirming}
                    aria-current={i === progress.lastIndex ? 'step' : undefined}
                    aria-label={`Domanda ${i + 1}, ${q.selectedOptionId ? 'confermata' : 'mancante'}`}
                    className={`min-h-12 rounded-lg border-2 text-sm ${i === progress.lastIndex ? 'border-indigo-300' : 'border-transparent'} ${q.selectedOptionId ? 'bg-emerald-500/20' : 'bg-white/5'}`}
                    onClick={() => void save(i, false)}
                  >
                    {i + 1} {q.selectedOptionId ? '✓' : '○'}
                  </button>
                ))}
              </nav>
            </section>
            <section className='rounded-2xl bg-white/5 p-4 ring-1 ring-white/10 sm:p-6'>
              <p className='text-sm font-bold text-indigo-300'>
                Domanda {progress.lastIndex + 1}/{progress.questions.length}
              </p>
              {question.prompt && (
                <h1 className='mt-3 break-words text-2xl font-bold'>
                  {question.prompt}
                </h1>
              )}
              {question.media && (
                <QuizMediaImage
                  sizes='(min-width: 640px) 40rem, calc(100vw - 4rem)'
                  priority
                  className='mt-4 max-h-80'
                  media={question.media}
                />
              )}
              <div className='mt-5 grid gap-3'>
                {question.options.map((o) => (
                  <button
                    key={o.id}
                    aria-pressed={draft === o.id}
                    disabled={busy || confirming}
                    onClick={() => setDraft(o.id)}
                    className={`min-h-16 rounded-xl border-2 p-4 text-left focus-visible:outline-2 focus-visible:outline-indigo-300 ${draft === o.id ? 'border-indigo-300 bg-indigo-500/25' : 'border-white/15'}`}
                  >
                    <span className='font-bold text-indigo-200'>
                      {getAnswerPositionLabel(o.position)}
                      {draft === o.id ? ' · Selezionata' : ''}
                    </span>
                    {o.text && (
                      <span className='mt-2 block break-words'>{o.text}</span>
                    )}
                    {o.media && (
                      <QuizMediaImage
                        sizes='(min-width: 640px) 40rem, calc(100vw - 4rem)'
                        className='mt-3 max-h-64'
                        media={o.media}
                      />
                    )}
                  </button>
                ))}
              </div>
              <p role='status' className='mt-4 text-sm text-amber-200'>
                {dirty
                  ? 'Scelta non salvata: premi Conferma.'
                  : question.selectedOptionId
                    ? 'Risposta salvata.'
                    : 'Domanda omessa: nessuna risposta salvata.'}
              </p>
              <button
                className={button + ' mt-3 text-sm'}
                disabled={busy || confirming || draft === null}
                onClick={() => setDraft(null)}
              >
                Deseleziona risposta
              </button>
            </section>
            <div className='flex flex-wrap gap-3'>
              <button
                className={button}
                disabled={
                  busy || offline || confirming || progress.lastIndex === 0
                }
                onClick={() => void save(progress.lastIndex - 1, false)}
              >
                Indietro
              </button>
              <button
                className={button + ' flex-1 bg-indigo-500'}
                disabled={busy || offline || confirming}
                onClick={() =>
                  void save(
                    Math.min(
                      progress.lastIndex + 1,
                      progress.questions.length - 1,
                    ),
                    true,
                  )
                }
              >
                {progress.lastIndex === progress.questions.length - 1
                  ? 'Conferma risposta'
                  : 'Conferma e continua'}
              </button>
              {progress.lastIndex < progress.questions.length - 1 && (
                <button
                  className={button}
                  disabled={busy || offline || confirming}
                  onClick={() => void save(progress.lastIndex + 1, false)}
                >
                  Salta
                </button>
              )}
            </div>
            {progress.lastIndex === progress.questions.length - 1 &&
              !confirming && (
                <button
                  className={button + ' w-full bg-emerald-700'}
                  disabled={busy || offline}
                  onClick={() => setConfirming(true)}
                >
                  Termina esame
                </button>
              )}
            {confirming && (
              <section
                role='alertdialog'
                aria-modal='false'
                aria-labelledby='exam-submit-title'
                aria-describedby='exam-submit-description'
                className='rounded-2xl border-2 border-amber-300 bg-slate-900 p-5'
              >
                <h2 id='exam-submit-title' className='text-xl font-bold'>
                  Stai per consegnare definitivamente il test.
                </h2>
                <p id='exam-submit-description' className='mt-3'>
                  Dopo la consegna non potrai più modificare le risposte.
                </p>
                <p className='mt-3'>
                  Risposte date: {progress.completedCount}. Domande mancanti:{' '}
                  {progress.questions.length - progress.completedCount}.
                </p>
                {dirty && (
                  <p className='mt-3 text-amber-200'>
                    La scelta attuale non è confermata e non verrà inclusa.
                    Torna alla revisione per salvarla.
                  </p>
                )}
                <div className='mt-5 flex flex-wrap gap-3'>
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() => setConfirming(false)}
                  >
                    Torna alla revisione
                  </button>
                  <button
                    className={button + ' bg-emerald-700'}
                    disabled={busy || offline}
                    onClick={() => void submit()}
                  >
                    Consegna definitivamente
                  </button>
                </div>
              </section>
            )}
          </>
        ) : null}
      </div>
    </main>
  );
}
