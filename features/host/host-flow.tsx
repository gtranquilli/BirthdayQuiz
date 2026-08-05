'use client';

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

interface QuizCategorySummary {
  readonly id: string;
  readonly name: string;
  readonly position: number;
  readonly availableQuestionCount: number;
}

interface PresetRuleSummary {
  readonly categoryId: string;
  readonly questionCount: number;
}

interface QuizPresetSummary {
  readonly id: string;
  readonly name: string;
  readonly rules: readonly PresetRuleSummary[];
}

interface QuizSummary {
  readonly id: string;
  readonly title: string;
  readonly categories: readonly QuizCategorySummary[];
  readonly presets: readonly QuizPresetSummary[];
}

interface CreatedSession {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly maxPlayers: number;
}

interface HostFlowProps {
  readonly initiallyAuthenticated: boolean;
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

function getErrorMessage(payload: unknown, fallback: string): string {
  if (
    isRecord(payload) &&
    typeof payload.error === 'string' &&
    payload.error.length > 0
  ) {
    return payload.error;
  }

  return fallback;
}

function createCategoryCounts(
  quiz: QuizSummary,
  presetId: string,
): Record<string, string> {
  const preset = quiz.presets.find((item) => item.id === presetId);
  const ruleCounts = new Map(
    preset?.rules.map((rule) => [rule.categoryId, rule.questionCount]) ?? [],
  );
  const counts: Record<string, string> = {};

  for (const category of quiz.categories) {
    counts[category.id] = String(ruleCounts.get(category.id) ?? 0);
  }

  return counts;
}

export function HostFlow({ initiallyAuthenticated }: HostFlowProps) {
  const [authenticated, setAuthenticated] = useState(initiallyAuthenticated);
  const [password, setPassword] = useState('');
  const [quizzes, setQuizzes] = useState<readonly QuizSummary[]>([]);
  const [selectedQuizId, setSelectedQuizId] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [categoryCounts, setCategoryCounts] = useState<
    Record<string, string>
  >({});
  const [maxPlayers, setMaxPlayers] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [createdSession, setCreatedSession] =
    useState<CreatedSession | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loadingQuizzes, setLoadingQuizzes] = useState(
    initiallyAuthenticated,
  );
  const [creatingSession, setCreatingSession] = useState(false);

  const selectedQuiz = useMemo(
    () => quizzes.find((quiz) => quiz.id === selectedQuizId) ?? null,
    [quizzes, selectedQuizId],
  );

  const loadQuizzes = useCallback(async () => {
    setLoadingQuizzes(true);
    setError(null);

    try {
      const response = await fetch('/api/host/quizzes', {
        cache: 'no-store',
      });
      const payload = await readJson(response);

      if (response.status === 401) {
        setAuthenticated(false);
        throw new Error('La sessione host è scaduta. Accedi di nuovo.');
      }

      if (!response.ok) {
        throw new Error(
          getErrorMessage(payload, 'Impossibile caricare quiz e preset.'),
        );
      }

      if (!isRecord(payload) || !Array.isArray(payload.quizzes)) {
        throw new Error('Il catalogo quiz ricevuto non è valido.');
      }

      const loadedQuizzes = payload.quizzes as QuizSummary[];
      const firstQuiz = loadedQuizzes[0];

      setQuizzes(loadedQuizzes);
      setCreatedSession(null);

      if (!firstQuiz) {
        setSelectedQuizId('');
        setSelectedPresetId('');
        setCategoryCounts({});
        return;
      }

      const firstPresetId = firstQuiz.presets[0]?.id ?? '';

      setSelectedQuizId(firstQuiz.id);
      setSelectedPresetId(firstPresetId);
      setCategoryCounts(createCategoryCounts(firstQuiz, firstPresetId));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Impossibile caricare quiz e preset.',
      );
    } finally {
      setLoadingQuizzes(false);
    }
  }, []);

  useEffect(() => {
    if (!authenticated) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void loadQuizzes();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [authenticated, loadQuizzes]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoggingIn(true);
    setError(null);

    try {
      const response = await fetch('/api/host/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const payload = await readJson(response);

      if (!response.ok) {
        throw new Error(
          getErrorMessage(payload, 'Impossibile effettuare l’accesso.'),
        );
      }

      setPassword('');
      setLoadingQuizzes(true);
      setAuthenticated(true);
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : 'Impossibile effettuare l’accesso.',
      );
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleLogout() {
    setError(null);

    try {
      const response = await fetch('/api/host/session', {
        method: 'DELETE',
      });

      if (!response.ok) {
        const payload = await readJson(response);
        throw new Error(
          getErrorMessage(payload, 'Impossibile terminare la sessione host.'),
        );
      }

      setAuthenticated(false);
      setQuizzes([]);
      setSelectedQuizId('');
      setSelectedPresetId('');
      setCategoryCounts({});
      setMaxPlayers('');
      setCreatedSession(null);
    } catch (logoutError) {
      setError(
        logoutError instanceof Error
          ? logoutError.message
          : 'Impossibile terminare la sessione host.',
      );
    }
  }

  function handleQuizChange(quizId: string) {
    const quiz = quizzes.find((item) => item.id === quizId);

    if (!quiz) {
      return;
    }

    const presetId = quiz.presets[0]?.id ?? '';

    setSelectedQuizId(quiz.id);
    setSelectedPresetId(presetId);
    setCategoryCounts(createCategoryCounts(quiz, presetId));
    setCreatedSession(null);
    setError(null);
  }

  function handlePresetChange(presetId: string) {
    if (!selectedQuiz) {
      return;
    }

    setSelectedPresetId(presetId);
    setCategoryCounts(createCategoryCounts(selectedQuiz, presetId));
    setCreatedSession(null);
    setError(null);
  }

  async function handleCreateSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCreatedSession(null);

    if (!selectedQuiz) {
      setError('Seleziona un quiz.');
      return;
    }

    const parsedMaxPlayers = Number(maxPlayers);

    if (
      maxPlayers.trim() === '' ||
      !Number.isInteger(parsedMaxPlayers) ||
      parsedMaxPlayers <= 0
    ) {
      setError('Inserisci un numero massimo giocatori maggiore di zero.');
      return;
    }

    const categoryConfig: Array<{
      categoryId: string;
      questionCount: number;
    }> = [];
    let totalQuestions = 0;

    for (const category of selectedQuiz.categories) {
      const rawCount = categoryCounts[category.id] ?? '';
      const questionCount = Number(rawCount);

      if (
        rawCount.trim() === '' ||
        !Number.isInteger(questionCount) ||
        questionCount < 0 ||
        questionCount > category.availableQuestionCount
      ) {
        setError(
          `Controlla il numero di domande per la categoria ${category.name}.`,
        );
        return;
      }

      categoryConfig.push({ categoryId: category.id, questionCount });
      totalQuestions += questionCount;
    }

    if (totalQuestions === 0) {
      setError('Seleziona almeno una domanda complessiva.');
      return;
    }

    const confirmed = window.confirm(
      `Creare una partita con massimo ${parsedMaxPlayers} giocatori?`,
    );

    if (!confirmed) {
      return;
    }

    setCreatingSession(true);

    try {
      const response = await fetch('/api/host/game-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quizId: selectedQuiz.id,
          presetId: selectedPresetId || null,
          maxPlayers: parsedMaxPlayers,
          categoryConfig,
        }),
      });
      const payload = await readJson(response);

      if (response.status === 401) {
        setAuthenticated(false);
        throw new Error('La sessione host è scaduta. Accedi di nuovo.');
      }

      if (!response.ok) {
        throw new Error(
          getErrorMessage(payload, 'Impossibile creare la partita.'),
        );
      }

      if (!isRecord(payload) || !isRecord(payload.session)) {
        throw new Error('La risposta di creazione non è valida.');
      }

      const session = payload.session;

      if (
        typeof session.id !== 'string' ||
        typeof session.code !== 'string' ||
        typeof session.title !== 'string' ||
        typeof session.maxPlayers !== 'number'
      ) {
        throw new Error('La risposta di creazione non è valida.');
      }

      setCreatedSession({
        id: session.id,
        code: session.code,
        title: session.title,
        maxPlayers: session.maxPlayers,
      });
    } catch (creationError) {
      setError(
        creationError instanceof Error
          ? creationError.message
          : 'Impossibile creare la partita.',
      );
    } finally {
      setCreatingSession(false);
    }
  }

  if (!authenticated) {
    return (
      <main className='grid min-h-screen place-items-center bg-slate-100 px-4 py-10'>
        <section className='w-full max-w-md rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200'>
          <p className='text-sm font-semibold uppercase tracking-wide text-indigo-600'>
            Quiz Engine
          </p>
          <h1 className='mt-2 text-2xl font-bold text-slate-950'>Accesso host</h1>
          <p className='mt-2 text-sm text-slate-600'>
            Inserisci la password condivisa per configurare una nuova partita.
          </p>

          <form className='mt-6 space-y-4' onSubmit={handleLogin}>
            <label className='block text-sm font-medium text-slate-800'>
              Password host
              <input
                className='mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-950 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100'
                type='password'
                autoComplete='current-password'
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={loggingIn}
                required
              />
            </label>

            {error ? (
              <p className='rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700'>
                {error}
              </p>
            ) : null}

            <button
              className='w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60'
              type='submit'
              disabled={loggingIn || password.length === 0}
            >
              {loggingIn ? 'Accesso in corso…' : 'Accedi'}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className='min-h-screen bg-slate-100 px-4 py-8 sm:px-6'>
      <div className='mx-auto max-w-3xl'>
        <header className='flex items-start justify-between gap-4'>
          <div>
            <p className='text-sm font-semibold uppercase tracking-wide text-indigo-600'>
              Quiz Engine
            </p>
            <h1 className='mt-1 text-3xl font-bold text-slate-950'>Crea partita</h1>
          </div>
          <button
            className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50'
            type='button'
            onClick={() => void handleLogout()}
          >
            Esci
          </button>
        </header>

        {error ? (
          <p className='mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100'>
            {error}
          </p>
        ) : null}

        {createdSession ? (
          <section className='mt-6 rounded-2xl bg-emerald-50 p-6 ring-1 ring-emerald-200'>
            <p className='text-sm font-semibold text-emerald-800'>Partita creata</p>
            <p className='mt-2 text-4xl font-black tracking-[0.2em] text-emerald-950'>
              {createdSession.code}
            </p>
            <dl className='mt-4 grid gap-2 text-sm text-emerald-950 sm:grid-cols-2'>
              <div>
                <dt className='font-medium'>Quiz</dt>
                <dd>{createdSession.title}</dd>
              </div>
              <div>
                <dt className='font-medium'>Massimo giocatori</dt>
                <dd>{createdSession.maxPlayers}</dd>
              </div>
              <div className='sm:col-span-2'>
                <dt className='font-medium'>ID sessione</dt>
                <dd className='break-all font-mono'>{createdSession.id}</dd>
              </div>
            </dl>
            <a
              className='mt-5 inline-flex rounded-xl bg-emerald-700 px-4 py-2.5 font-semibold text-white hover:bg-emerald-800'
              href={`/display/${createdSession.code}`}
              target='_blank'
              rel='noreferrer'
            >
              Apri il display della lobby
            </a>
          </section>
        ) : null}

        <section className='mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7'>
          {loadingQuizzes ? (
            <p className='text-sm text-slate-600'>Caricamento quiz e preset…</p>
          ) : quizzes.length === 0 ? (
            <div>
              <p className='font-medium text-slate-900'>Nessun quiz disponibile.</p>
              <button
                className='mt-3 text-sm font-semibold text-indigo-700 hover:text-indigo-900'
                type='button'
                onClick={() => void loadQuizzes()}
              >
                Riprova
              </button>
            </div>
          ) : (
            <form className='space-y-6' onSubmit={handleCreateSession}>
              <div className='grid gap-5 sm:grid-cols-2'>
                <label className='block text-sm font-medium text-slate-800'>
                  Quiz
                  <select
                    className='mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-950 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100'
                    value={selectedQuizId}
                    onChange={(event) => handleQuizChange(event.target.value)}
                    disabled={creatingSession}
                  >
                    {quizzes.map((quiz) => (
                      <option key={quiz.id} value={quiz.id}>
                        {quiz.title}
                      </option>
                    ))}
                  </select>
                </label>

                <label className='block text-sm font-medium text-slate-800'>
                  Preset
                  <select
                    className='mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-950 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100'
                    value={selectedPresetId}
                    onChange={(event) => handlePresetChange(event.target.value)}
                    disabled={creatingSession}
                  >
                    <option value=''>Configurazione personalizzata</option>
                    {selectedQuiz?.presets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <fieldset className='space-y-3'>
                <legend className='text-base font-semibold text-slate-950'>
                  Domande per categoria
                </legend>
                {selectedQuiz?.categories.map((category) => (
                  <label
                    className='flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-4 py-3'
                    key={category.id}
                  >
                    <span>
                      <span className='block font-medium text-slate-900'>
                        {category.name}
                      </span>
                      <span className='block text-xs text-slate-500'>
                        Disponibili: {category.availableQuestionCount}
                      </span>
                    </span>
                    <input
                      className='w-24 rounded-lg border border-slate-300 px-3 py-2 text-right text-slate-950 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100'
                      type='number'
                      inputMode='numeric'
                      min={0}
                      max={category.availableQuestionCount}
                      step={1}
                      value={categoryCounts[category.id] ?? ''}
                      onChange={(event) => {
                        setCategoryCounts((current) => ({
                          ...current,
                          [category.id]: event.target.value,
                        }));
                        setCreatedSession(null);
                      }}
                      disabled={creatingSession}
                      required
                    />
                  </label>
                ))}
              </fieldset>

              <label className='block text-sm font-medium text-slate-800'>
                Numero massimo giocatori
                <input
                  className='mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-950 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 sm:max-w-xs'
                  type='number'
                  inputMode='numeric'
                  min={1}
                  step={1}
                  placeholder='Es. 7'
                  value={maxPlayers}
                  onChange={(event) => {
                    setMaxPlayers(event.target.value);
                    setCreatedSession(null);
                  }}
                  disabled={creatingSession}
                  required
                />
              </label>

              <button
                className='w-full rounded-lg bg-indigo-600 px-4 py-3 font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:min-w-52'
                type='submit'
                disabled={creatingSession}
              >
                {creatingSession ? 'Creazione in corso…' : 'Crea partita'}
              </button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
