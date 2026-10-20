'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  GAME_CODE_PATTERN,
  normalizeGameCode,
  parsePublicGameSnapshot,
  type PublicGameSnapshot,
} from '@/lib/game/lobby';
import { createClient } from '@/lib/supabase/client';

export type LobbyConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'offline'
  | 'error';

interface LobbySessionState {
  readonly snapshot: PublicGameSnapshot | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly connectionStatus: LobbyConnectionStatus;
  readonly refresh: () => Promise<void>;
}

export function useLobbySession(rawCode: string): LobbySessionState {
  const code = useMemo(() => normalizeGameCode(rawCode), [rawCode]);
  const supabase = useMemo(() => createClient(), []);
  const [snapshot, setSnapshot] = useState<PublicGameSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<LobbyConnectionStatus>('connecting');

  const refresh = useCallback(async () => {
    if (!GAME_CODE_PATTERN.test(code)) {
      setSnapshot(null);
      setError('Il codice stanza non è valido.');
      setLoading(false);
      return;
    }

    const { data, error: queryError } = await supabase
      .from('lobby_public_sessions')
      .select(
        'mode,submitted_count,code,quiz_title,phase,participant_count,max_players,current_question_index,total_question_count,current_question,voted_count,players,correct_option_id,non_voters,leaderboard',
      )
      .eq('code', code)
      .maybeSingle();

    if (queryError) {
      setError('Impossibile aggiornare la lobby. Riprova.');
      setLoading(false);
      return;
    }

    if (!data) {
      setSnapshot(null);
      setError('Stanza non trovata. Controlla il codice.');
      setLoading(false);
      return;
    }

    const nextSnapshot = parsePublicGameSnapshot(data);

    if (!nextSnapshot) {
      setError('La lobby ha restituito dati non validi.');
      setLoading(false);
      return;
    }

    setSnapshot(nextSnapshot);
    setError(null);
    setLoading(false);
  }, [code, supabase]);

  useEffect(() => {
    const channel = supabase
      .channel(`lobby:${code}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'lobby_public_sessions',
          filter: `code=eq.${code}`,
        },
        (payload: { new: unknown }) => {
          const nextSnapshot = parsePublicGameSnapshot(payload.new);

          if (nextSnapshot) {
            setSnapshot(nextSnapshot);
            setError(null);
            setLoading(false);
          }
        },
      )
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          setConnectionStatus('connected');
          void refresh();
          return;
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setConnectionStatus('error');
        }

        if (status === 'CLOSED' && !navigator.onLine) {
          setConnectionStatus('offline');
        }
      });

    const handleOffline = () => setConnectionStatus('offline');
    const handleOnline = () => {
      setConnectionStatus('connecting');
      void refresh();
    };
    const initialRefreshId = window.setTimeout(() => {
      void refresh();
    }, 0);

    const handleVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', handleVisible);
    window.addEventListener('pageshow', handleVisible);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.clearTimeout(initialRefreshId);
      document.removeEventListener('visibilitychange', handleVisible);
      window.removeEventListener('pageshow', handleVisible);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      void supabase.removeChannel(channel);
    };
  }, [code, refresh, supabase]);

  return { snapshot, loading, error, connectionStatus, refresh };
}
