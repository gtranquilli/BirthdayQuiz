'use client';

import Link from 'next/link';
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

import { QuizMediaImage } from '@/components/quiz-media-image';
import {
  QUIZ_MEDIA_MAX_BYTES,
  QUIZ_MEDIA_MIME_TYPES,
  type QuizMedia,
} from '@/lib/game/media';

interface ContentAnswer {
  readonly id: string;
  readonly position: number;
  readonly label: string | null;
  readonly media: QuizMedia | null;
}

interface ContentQuestion {
  readonly id: string;
  readonly prompt: string | null;
  readonly media: QuizMedia | null;
  readonly answers: readonly ContentAnswer[];
}

interface ContentCategory {
  readonly id: string;
  readonly name: string;
  readonly position: number;
  readonly questions: readonly ContentQuestion[];
}

interface ContentQuiz {
  readonly id: string;
  readonly title: string;
  readonly categories: readonly ContentCategory[];
}

interface MediaEditorProps {
  readonly entityType: 'question' | 'answer';
  readonly entityId: string;
  readonly title: string;
  readonly text: string | null;
  readonly media: QuizMedia | null;
  readonly onChanged: () => Promise<void>;
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

function MediaEditor({
  entityType,
  entityId,
  title,
  text,
  media,
  onChanged,
}: MediaEditorProps) {
  const [altText, setAltText] = useState(media?.altText ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  useEffect(
    () => () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    },
    [previewUrl],
  );

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!file || altText.trim().length === 0) {
      setError('Seleziona un file e inserisci il testo alternativo.');
      return;
    }

    if (file.size > QUIZ_MEDIA_MAX_BYTES) {
      setError('Il file supera il limite di 5 MB.');
      return;
    }

    if (!QUIZ_MEDIA_MIME_TYPES.includes(file.type as never)) {
      setError('Usa un’immagine JPEG, PNG o WebP.');
      return;
    }

    setBusy(true);

    try {
      const formData = new FormData();
      formData.set('entityType', entityType);
      formData.set('entityId', entityId);
      formData.set('altText', altText.trim());
      formData.set('file', file);
      const response = await fetch('/api/host/content/media', {
        method: 'POST',
        body: formData,
      });
      const payload = await readJson(response);

      if (!response.ok) {
        throw new Error(getErrorMessage(payload, 'Upload non riuscito.'));
      }

      setFile(null);
      await onChanged();
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : 'Upload non riuscito.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!media || !window.confirm('Rimuovere definitivamente questa immagine?')) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/host/content/media', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityType, entityId }),
      });
      const payload = await readJson(response);

      if (!response.ok) {
        throw new Error(getErrorMessage(payload, 'Rimozione non riuscita.'));
      }

      setAltText('');
      await onChanged();
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : 'Rimozione non riuscita.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className='rounded-2xl bg-white p-5 ring-1 ring-slate-200'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <p className='text-xs font-black uppercase tracking-wide text-indigo-700'>
            {title}
          </p>
          <p className='mt-1 break-words font-semibold text-slate-950'>
            {text ?? 'Contenuto solo immagine'}
          </p>
        </div>
        {media ? (
          <span className='rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800'>
            Immagine associata
          </span>
        ) : null}
      </div>

      {previewUrl ? (
        <div
          aria-label={`Anteprima: ${altText || file?.name || 'nuova immagine'}`}
          className='mt-4 min-h-48 rounded-2xl bg-slate-100 bg-contain bg-center bg-no-repeat ring-1 ring-slate-200'
          role='img'
          style={{ backgroundImage: `url(${previewUrl})` }}
        />
      ) : media ? (
        <QuizMediaImage
          className='mt-4 max-h-72 bg-slate-100 ring-slate-200'
          media={media}
          sizes='(min-width: 768px) 36rem, calc(100vw - 4rem)'
        />
      ) : null}

      <form className='mt-4 grid gap-4' onSubmit={upload}>
        <label className='text-sm font-semibold text-slate-800'>
          File immagine
          <input
            accept={QUIZ_MEDIA_MIME_TYPES.join(',')}
            className='mt-2 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:font-bold file:text-indigo-800'
            type='file'
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            disabled={busy}
          />
        </label>
        <label className='text-sm font-semibold text-slate-800'>
          Testo alternativo
          <input
            className='mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-950 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100'
            maxLength={500}
            placeholder='Descrivi ciò che è necessario capire nell’immagine'
            value={altText}
            onChange={(event) => setAltText(event.target.value)}
            disabled={busy}
            required
          />
        </label>

        {error ? (
          <p className='rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700'>
            {error}
          </p>
        ) : null}

        <div className='flex flex-wrap gap-3'>
          <button
            className='rounded-xl bg-indigo-600 px-4 py-2.5 font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50'
            type='submit'
            disabled={busy || !file || altText.trim().length === 0}
          >
            {busy ? 'Salvataggio…' : media ? 'Sostituisci immagine' : 'Carica immagine'}
          </button>
          {media ? (
            <button
              className='rounded-xl border border-red-300 px-4 py-2.5 font-bold text-red-700 hover:bg-red-50 disabled:opacity-50'
              type='button'
              onClick={() => void remove()}
              disabled={busy}
            >
              Rimuovi immagine
            </button>
          ) : null}
        </div>
      </form>
    </article>
  );
}

export function ContentMediaManager() {
  const [quizzes, setQuizzes] = useState<readonly ContentQuiz[]>([]);
  const [selectedQuizId, setSelectedQuizId] = useState('');
  const [selectedQuestionId, setSelectedQuestionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadContent = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/host/content', { cache: 'no-store' });
      const payload = await readJson(response);

      if (!response.ok) {
        throw new Error(
          getErrorMessage(payload, 'Impossibile caricare i contenuti.'),
        );
      }

      if (!isRecord(payload) || !Array.isArray(payload.quizzes)) {
        throw new Error('Risposta contenuti non valida.');
      }

      const nextQuizzes = payload.quizzes as ContentQuiz[];
      setQuizzes(nextQuizzes);
      setSelectedQuizId((current) => current || nextQuizzes[0]?.id || '');
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Impossibile caricare i contenuti.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadContent(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadContent]);

  const selectedQuiz = quizzes.find((quiz) => quiz.id === selectedQuizId) ?? null;
  const questionChoices = useMemo(
    () =>
      selectedQuiz?.categories.flatMap((category) =>
        category.questions.map((question) => ({ question, category })),
      ) ?? [],
    [selectedQuiz],
  );
  const selectedChoice =
    questionChoices.find((choice) => choice.question.id === selectedQuestionId) ??
    questionChoices[0] ??
    null;

  return (
    <main className='min-h-screen bg-slate-100 px-4 py-8 sm:px-6'>
      <div className='mx-auto max-w-5xl'>
        <header className='flex flex-wrap items-start justify-between gap-4'>
          <div>
            <Link className='font-semibold text-indigo-700' href='/host'>
              ← Torna all’host
            </Link>
            <h1 className='mt-2 text-3xl font-black text-slate-950'>Media del quiz</h1>
            <p className='mt-2 max-w-2xl text-sm text-slate-600'>
              Associa immagini ai contenuti esistenti. JPEG, PNG o WebP, massimo 5 MB.
            </p>
          </div>
          <button
            className='rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700'
            type='button'
            onClick={() => void loadContent()}
            disabled={loading}
          >
            Aggiorna
          </button>
        </header>

        {error ? (
          <p className='mt-6 rounded-xl bg-red-50 px-4 py-3 font-semibold text-red-700'>
            {error}
          </p>
        ) : null}

        <section className='mt-6 grid gap-4 rounded-2xl bg-white p-5 ring-1 ring-slate-200 sm:grid-cols-2'>
          <label className='text-sm font-semibold text-slate-800'>
            Quiz
            <select
              className='mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2'
              value={selectedQuizId}
              onChange={(event) => {
                setSelectedQuizId(event.target.value);
                setSelectedQuestionId('');
              }}
            >
              {quizzes.map((quiz) => (
                <option key={quiz.id} value={quiz.id}>{quiz.title}</option>
              ))}
            </select>
          </label>
          <label className='text-sm font-semibold text-slate-800'>
            Domanda
            <select
              className='mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2'
              value={selectedChoice?.question.id ?? ''}
              onChange={(event) => setSelectedQuestionId(event.target.value)}
            >
              {questionChoices.map(({ question, category }) => (
                <option key={question.id} value={question.id}>
                  {category.name} — {question.prompt ?? 'Domanda solo immagine'}
                </option>
              ))}
            </select>
          </label>
        </section>

        {loading ? (
          <p className='mt-8 text-center text-slate-600'>Caricamento contenuti…</p>
        ) : selectedChoice ? (
          <div className='mt-6 grid gap-5'>
            <MediaEditor
              entityId={selectedChoice.question.id}
              entityType='question'
              key={`question:${selectedChoice.question.id}`}
              media={selectedChoice.question.media}
              onChanged={loadContent}
              text={selectedChoice.question.prompt}
              title={`Domanda · ${selectedChoice.category.name}`}
            />
            <div className='grid gap-5 md:grid-cols-2'>
              {selectedChoice.question.answers.map((answer) => (
                <MediaEditor
                  entityId={answer.id}
                  entityType='answer'
                  key={answer.id}
                  media={answer.media}
                  onChanged={loadContent}
                  text={answer.label}
                  title={`Risposta ${String.fromCharCode(64 + answer.position)}`}
                />
              ))}
            </div>
          </div>
        ) : (
          <p className='mt-8 text-center text-slate-600'>Nessuna domanda disponibile.</p>
        )}
      </div>
    </main>
  );
}
