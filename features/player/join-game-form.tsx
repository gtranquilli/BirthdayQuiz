'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useMemo, useState } from 'react';

import { AvatarBadge } from '@/components/avatar-badge';
import { AVATARS, isAvatarKey, type AvatarKey } from '@/lib/game/avatars';
import {
  GAME_CODE_PATTERN,
  normalizeGameCode,
  saveStoredPlayer,
} from '@/lib/game/lobby';
import { getOrCreateAnonymousSession } from '@/lib/game/participant-recovery';
import { isRejoinToken, saveRejoinToken } from '@/lib/game/rejoin-token';
import { createClient } from '@/lib/supabase/client';

interface JoinedPlayerResponse {
  readonly code: string;
  readonly nickname: string;
  readonly avatarKey: AvatarKey;
  readonly rejoinToken: string;
}

interface JoinGameFormProps {
  readonly code: string;
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
    !isAvatarKey(value.player.avatarKey) ||
    !isRejoinToken(value.rejoinToken)
  ) {
    return null;
  }

  return {
    code: value.session.code,
    nickname: value.player.nickname,
    avatarKey: value.player.avatarKey,
    rejoinToken: value.rejoinToken,
  };
}

export function JoinGameForm({ code: rawCode }: JoinGameFormProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const code = normalizeGameCode(rawCode);
  const [nickname, setNickname] = useState('');
  const [avatarKey, setAvatarKey] = useState<AvatarKey>(AVATARS[0].key);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const normalizedNickname = nickname.trim().replace(/\s+/g, ' ');

    if (!GAME_CODE_PATTERN.test(code)) {
      setError('Inserisci un codice stanza valido di 6 caratteri.');
      return;
    }

    if (normalizedNickname.length < 2 || normalizedNickname.length > 20) {
      setError('Il nickname deve contenere da 2 a 20 caratteri.');
      return;
    }

    setSubmitting(true);

    try {
      const session = await getOrCreateAnonymousSession(supabase);

      const response = await fetch('/api/game-sessions/join', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code,
          nickname: normalizedNickname,
          avatarKey,
          rotateRejoinToken: true,
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

      const playerSaved = saveStoredPlayer(joinedPlayer.code, {
        nickname: joinedPlayer.nickname,
        avatarKey: joinedPlayer.avatarKey,
      });
      const tokenSaved = saveRejoinToken(
        joinedPlayer.code,
        joinedPlayer.rejoinToken,
      );

      if (!playerSaved || !tokenSaved) {
        throw new Error(
          'Ingresso riuscito, ma il browser non consente di salvare il recupero locale.',
        );
      }

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
      <label className='block text-sm font-semibold text-slate-100'>
        Nickname
        <input
          className='mt-2 min-h-12 w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3 text-base text-white outline-none placeholder:text-slate-600 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-400/20 disabled:cursor-not-allowed disabled:opacity-50'
          type='text'
          inputMode='text'
          autoComplete='off'
          autoCapitalize='words'
          enterKeyHint='done'
          minLength={2}
          maxLength={20}
          placeholder='Come vuoi chiamarti?'
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          disabled={submitting}
          required
        />
      </label>

      <fieldset>
        <legend className='text-sm font-semibold text-slate-100'>
          Scegli il tuo avatar
        </legend>
        <div className='mt-3 grid grid-cols-4 gap-2.5 sm:grid-cols-6 sm:gap-3'>
          {AVATARS.map((avatar) => {
            const selected = avatar.key === avatarKey;
            return (
              <button
                aria-label={`Scegli ${avatar.label}`}
                aria-pressed={selected}
                className={`flex min-h-20 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border p-2 text-xs font-medium transition focus:outline-none focus:ring-4 focus:ring-indigo-400/30 disabled:cursor-not-allowed disabled:opacity-50 ${
                  selected
                    ? 'border-indigo-300 bg-indigo-500/25 text-indigo-100 ring-2 ring-indigo-400'
                    : 'border-white/10 bg-white/5 text-slate-300 hover:border-indigo-400/70 hover:bg-white/10'
                }`}
                key={avatar.key}
                type='button'
                onClick={() => setAvatarKey(avatar.key)}
                disabled={submitting}
              >
                <AvatarBadge avatarKey={avatar.key} size='sm' />
                <span className='w-full truncate'>{avatar.label}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {error ? (
        <p
          className='rounded-xl bg-red-500/15 px-4 py-3 text-sm font-semibold text-red-200 ring-1 ring-red-400/30'
          role='alert'
        >
          {error}
        </p>
      ) : null}

      <button
        className='w-full rounded-xl bg-indigo-500 px-5 py-3.5 text-base font-bold text-white shadow-sm hover:bg-indigo-400 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-300/40 disabled:cursor-not-allowed disabled:opacity-50'
        type='submit'
        disabled={submitting}
      >
        {submitting ? 'Ingresso in corso…' : 'Entra nella partita'}
      </button>
    </form>
  );
}
