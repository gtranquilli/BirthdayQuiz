import type { SupabaseClient } from '@supabase/supabase-js';
import type { PublicGameSnapshot } from '@/lib/game/lobby';

export type LobbyConnectionStatus = 'connecting' | 'connected' | 'offline' | 'error';
export interface LobbySessionState {
  readonly snapshot: PublicGameSnapshot | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly connectionStatus: LobbyConnectionStatus;
}
const INITIAL: LobbySessionState = {
  snapshot: null, loading: true, error: null, connectionStatus: 'connecting',
};
let nextChannelId = 0;

// One owner per client/room, shared by every mounted surface using that room.
// The hook registry retains only this small idle object after the last release.
export function createLobbySessionStore(
  client: SupabaseClient,
  code: string,
  parse: (value: unknown) => PublicGameSnapshot | null,
) {
  const listeners = new Set<() => void>();
  let state = INITIAL;
  let generation = 0;
  let revision = 0;
  let channel: ReturnType<SupabaseClient['channel']> | null = null;
  let removal: Promise<unknown> = Promise.resolve();
  let request: AbortController | null = null;
  let pending: Promise<void> | null = null;

  const publish = (patch: Partial<LobbySessionState>) => {
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
  };
  const active = (id: number) => id === generation && listeners.size > 0;

  function refresh(): Promise<void> {
    if (listeners.size === 0) return Promise.resolve();
    if (pending) return pending;
    const id = generation;
    const version = revision;
    const controller = new AbortController();
    request = controller;
    const task = (async () => {
      try {
        const { data, error } = await client.from('lobby_public_sessions')
          .select('mode,submitted_count,code,quiz_title,phase,participant_count,max_players,current_question_index,total_question_count,current_question,voted_count,players,correct_option_id,non_voters,leaderboard')
          .eq('code', code).abortSignal(controller.signal).maybeSingle();
        if (!active(id) || controller.signal.aborted || version !== revision) return;
        if (error) {
          publish({ error: 'Impossibile aggiornare la lobby. Riprova.', loading: false });
          return;
        }
        if (!data) {
          publish({ snapshot: null, error: 'Stanza non trovata. Controlla il codice.', loading: false });
          return;
        }
        const snapshot = parse(data);
        publish(snapshot ? { snapshot, error: null, loading: false }
          : { error: 'La lobby ha restituito dati non validi.', loading: false });
      } catch {
        if (active(id) && !controller.signal.aborted && version === revision) {
          publish({ error: 'Impossibile aggiornare la lobby. Riprova.', loading: false });
        }
      }
    })();
    pending = task;
    void task.finally(() => {
      if (pending === task) { pending = null; request = null; }
    });
    return task;
  }

  const offline = () => publish({ connectionStatus: 'offline' });
  const online = () => { publish({ connectionStatus: 'connecting' }); void refresh(); };
  const visible = () => { if (document.visibilityState === 'visible') void refresh(); };

  async function start(id: number) {
    await removal;
    if (!active(id)) return;
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) {
      publish({ snapshot: null, loading: false, error: 'Il codice stanza non è valido.' });
      return;
    }
    // Unique generation topic also handles SDK unsubscribe timeouts: an old channel
    // can never be returned and extended by a later channel(topic) call.
    channel = client.channel(`lobby:${code}:${++nextChannelId}`);
    channel.on('postgres_changes', {
      event: '*', schema: 'public', table: 'lobby_public_sessions', filter: `code=eq.${code}`,
    }, payload => {
      if (!active(id)) return;
      revision++;
      request?.abort(); pending = null; request = null;
      if (payload.eventType === 'DELETE') {
        publish({ snapshot: null, loading: false, error: 'Stanza non più disponibile.' });
        return;
      }
      const snapshot = parse(payload.new);
      if (snapshot) publish({ snapshot, loading: false, error: null });
      else void refresh();
    });
    // Every callback above is registered exactly once, before this sole subscribe.
    channel.subscribe(status => {
      if (!active(id)) return;
      if (status === 'SUBSCRIBED') {
        publish({ connectionStatus: 'connected' });
        // Fetch again after joining, even if a pre-subscription read is in flight.
        revision++; request?.abort(); pending = null; request = null;
        void refresh();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        publish({ connectionStatus: navigator.onLine ? 'error' : 'offline' });
      }
    });
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    window.addEventListener('pageshow', visible);
    document.addEventListener('visibilitychange', visible);
    if (!navigator.onLine) offline();
    void refresh();
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    if (listeners.size === 1) void start(++generation);
    return () => {
      listeners.delete(listener);
      if (listeners.size !== 0) return;
      generation++; revision++;
      request?.abort(); request = null; pending = null;
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      window.removeEventListener('pageshow', visible);
      document.removeEventListener('visibilitychange', visible);
      const previous = channel;
      channel = null;
      state = INITIAL;
      // No new subscription is created until the previous removal has settled.
      if (previous) removal = client.removeChannel(previous).then(
        status => { if (status !== 'ok') previous.teardown(); },
        () => previous.teardown(),
      );
    };
  }
  return { subscribe, getSnapshot: () => state, getServerSnapshot: () => INITIAL, refresh };
}
