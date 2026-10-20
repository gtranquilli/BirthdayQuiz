'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { normalizeGameCode, parsePublicGameSnapshot } from '@/lib/game/lobby';
import { createClient } from '@/lib/supabase/client';
import { createLobbySessionStore } from './lobby-session-store';
export type { LobbyConnectionStatus } from './lobby-session-store';

type Client = ReturnType<typeof createClient>;
type Store = ReturnType<typeof createLobbySessionStore>;
const stores = new WeakMap<Client, Map<string, Store>>();

function getStore(client: Client, code: string): Store {
  let rooms = stores.get(client);
  if (!rooms) { rooms = new Map(); stores.set(client, rooms); }
  let store = rooms.get(code);
  if (!store) {
    store = createLobbySessionStore(client, code, parsePublicGameSnapshot);
    rooms.set(code, store);
  }
  return store;
}

export function useLobbySession(rawCode: string) {
  const code = normalizeGameCode(rawCode);
  const client = useMemo(() => createClient(), []);
  const store = useMemo(() => getStore(client, code), [client, code]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return { ...state, refresh: store.refresh };
}
