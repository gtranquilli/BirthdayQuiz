'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import { GAME_CODE_PATTERN, normalizeGameCode } from '@/lib/game/lobby';

export function JoinCodeForm() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedCode = normalizeGameCode(code);

    if (!GAME_CODE_PATTERN.test(normalizedCode)) {
      setError('Inserisci un codice stanza valido di 6 caratteri.');
      return;
    }

    setError(null);
    router.push(`/join/${normalizedCode}`);
  }

  return (
    <form className='space-y-5' onSubmit={handleSubmit}>
      <label className='block text-sm font-semibold text-slate-100'>
        Codice stanza
        <input
          className='mt-2 min-h-14 w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3 text-center text-xl font-black uppercase tracking-[0.2em] text-white outline-none placeholder:text-slate-600 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-400/20'
          type='text'
          inputMode='text'
          autoComplete='one-time-code'
          autoCapitalize='characters'
          enterKeyHint='go'
          maxLength={6}
          placeholder='ABC234'
          value={code}
          onChange={(event) =>
            setCode(event.target.value.toUpperCase().replace(/\s/g, ''))
          }
          required
        />
      </label>

      {error ? (
        <p
          className='rounded-xl bg-red-500/15 px-4 py-3 text-sm font-semibold text-red-200 ring-1 ring-red-400/30'
          role='alert'
        >
          {error}
        </p>
      ) : null}

      <button
        className='min-h-12 w-full rounded-xl bg-indigo-500 px-5 py-3.5 text-base font-bold text-white hover:bg-indigo-400 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-300/40'
        type='submit'
      >
        Continua
      </button>
    </form>
  );
}
