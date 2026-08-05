'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useMemo, useState } from 'react';

import { AvatarBadge } from '@/components/avatar-badge';
import { AVATARS, isAvatarKey, type AvatarKey } from '@/lib/game/avatars';
import {
  GAME_CODE_PATTERN,
  getPlayerStorageKey,
  normalizeGameCode,
} from '@/lib/game/lobby';
import { createClient } from '@/lib/supabase/client';

interface JoinedPlayerResponse {
  readonly code: string;
  readonly nickname: string;
  readonly avatarKey: AvatarKey;
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

function parseJoinedPlayer(value: unknown): JoinedPlayerResponse | null {
  if (
    !isRecord(value) ||
    !isRecord(value.player) ||
    !isRecord(value.session) ||
    typeof value.session.code !== 'string' ||
    typeof value.player.nickname !== 'string' ||
    !isAvatarKey(value.player.avatarKey)
  ) {
    return null;
  }

  return {
    code: value.session.code,
    nickname: value.player.nickname,
    avatarKey: value.player.avatarKey,
  };
}

export function JoinGameForm() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [code, setCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [avatarKey, setAvatarKey] = useState<AvatarKey>(AVATARS[0].key);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const normalizedCode = normalizeGameCode(code);
    const normalizedNickname = nickname.trim().replace(/\s+/g, ' ');

    if (!GAME_CODE_PATTERN.test(normalizedCode)) {
      setError('Inserisci un codice stanza valido di 6 caratteri.');
      return;
    }

    if (normalizedNickname.length < 2 || normalizedNickname.length > 20) {
      setError('Il nickname deve contenere da 2 a 20 caratteri.');
      return;
    }

    setSubmitting(true);

    try {
      const sessionResult = await supabase.auth.getSession();

      if (sessionResult.error) {
        throw new Error('Impossibile recuperare la sessione partecipante.');
      }

      let session = sessionResult.data.session;

      if (session && session.user.is_anonymous !== true) {
        throw new Error('È richiesta una sessione partecipante anonima.');
      }

      if (!session) {
        const signInResult = await supabase.auth.signInAnonymously();

        if (signInResult.error || !signInResult.data.session) {
          throw new Error(
            'Impossibile creare la sessione anonima. Riprova tra poco.',
          );
        }

        session = signInResult.data.session;
      }

      const response = await fetch('/api/game-sessions/join', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: normalizedCode,
          nickname: normalizedNickname,
          avatarKey,
        }),
      });
      const payload = await readJson(response);

      if (!response.ok) {
        throw new Error(
          getErrorMessage(payload, 'Impossibile entrare nella partita.'),
        );
      }

      const joinedPlayer = parseJoinedPlayer(payload);

      if (!joinedPlayer) {
        throw new Error('La risposta di ingresso non è valida.');
      }

      window.localStorage.setItem(
        getPlayerStorageKey(joinedPlayer.code),
        JSON.stringify({
          nickname: joinedPlayer.nickname,
          avatarKey: joinedPlayer.avatarKey,
        }),
      );
      router.push(`/play/${joinedPlayer.code}`);
    } catch (joinError) {
      setError(
        joinError instanceof Error
          ? joinError.message
          : 'Impossibile entrare nella partita.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className='space-y-6' onSubmit={handleSubmit}>
      <div className='grid gap-4 sm:grid-cols-2'>
        <label className='block text-sm font-semibold text-slate-800'>
          Codice stanza
          <input
            className='mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-center text-xl font-black uppercase tracking-[0.2em] text-slate-950 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100'
            type='text'
            inputMode='text'
            autoComplete='one-time-code'
            maxLength={6}
            placeholder='ABC234'
            value={code}
            onChange={(event) =>
              setCode(event.target.value.toUpperCase().replace(/\s/g, ''))
            }
            disabled={submitting}
            required
          />
        </label>
        <label className='block text-sm font-semibold text-slate-800'>
          Nickname
          <input
            className='mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-950 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100'
            type='text'
            autoComplete='nickname'
            minLength={2}
            maxLength={20}
            placeholder='Come vuoi chiamarti?'
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            disabled={submitting}
            required
          />
        </label>
      </div>

      <fieldset>
        <legend className='text-sm font-semibold text-slate-800'>
          Scegli il tuo avatar
        </legend>
        <div className='mt-3 grid grid-cols-4 gap-3 sm:grid-cols-6'>
          {AVATARS.map((avatar) => {
            const selected = avatar.key === avatarKey;
            return (
              <button
                aria-label={`Scegli ${avatar.label}`}
                aria-pressed={selected}
                className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border p-2 text-xs font-medium transition focus:outline-none focus:ring-4 focus:ring-indigo-100 ${
                  selected
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-900'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300'
                }`}
                key={avatar.key}
                type='button'
                onClick={() => setAvatarKey(avatar.key)}
                disabled={submitting}
              >
                <AvatarBadge avatarKey={avatar.key} size='sm' />
                <span>{avatar.label}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {error ? (
        <p
          className='rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100'
          role='alert'
        >
          {error}
        </p>
      ) : null}

      <button
        className='w-full rounded-xl bg-indigo-600 px-5 py-3.5 text-base font-bold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60'
        type='submit'
        disabled={submitting}
      >
        {submitting ? 'Ingresso in corso…' : 'Entra nella partita'}
      </button>
    </form>
  );
}
