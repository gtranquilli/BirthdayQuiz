import { createClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';

import { isAvatarKey } from '@/lib/game/avatars';
import { GAME_CODE_PATTERN, normalizeGameCode } from '@/lib/game/lobby';
import { hasValidRequestOrigin } from '@/lib/http/origin';

export const runtime = 'nodejs';

interface JoinGameInput {
  readonly code: string;
  readonly nickname: string;
  readonly avatarKey: string;
}

interface JoinedGameRow {
  readonly session_code: string;
  readonly player_nickname: string;
  readonly player_avatar_key: string;
  readonly session_phase: string;
  readonly quiz_title: string;
  readonly max_players: number;
  readonly participant_count: number;
}

interface SupabaseRpcError {
  readonly code?: string;
  readonly message?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getRequiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required server environment variable: ${name}`);
  }

  return value;
}

function getBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization');

  if (!authorization?.startsWith('Bearer ')) {
    return null;
  }

  const token = authorization.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

function parseInput(value: unknown): JoinGameInput | null {
  if (
    !isRecord(value) ||
    typeof value.code !== 'string' ||
    typeof value.nickname !== 'string' ||
    !isAvatarKey(value.avatarKey)
  ) {
    return null;
  }

  const code = normalizeGameCode(value.code);
  const nickname = value.nickname.trim().replace(/\s+/g, ' ');

  if (!GAME_CODE_PATTERN.test(code) || nickname.length < 2 || nickname.length > 20) {
    return null;
  }

  return { code, nickname, avatarKey: value.avatarKey };
}

function isJoinedGameRow(value: unknown): value is JoinedGameRow {
  return (
    isRecord(value) &&
    typeof value.session_code === 'string' &&
    typeof value.player_nickname === 'string' &&
    isAvatarKey(value.player_avatar_key) &&
    typeof value.session_phase === 'string' &&
    typeof value.quiz_title === 'string' &&
    typeof value.max_players === 'number' &&
    typeof value.participant_count === 'number'
  );
}

function rpcErrorResponse(error: SupabaseRpcError) {
  const message = error.message?.toLowerCase() ?? '';

  if (error.code === 'P0002') {
    return NextResponse.json(
      { error: 'Codice stanza inesistente.' },
      { status: 404 },
    );
  }

  if (error.code === '23505') {
    return NextResponse.json(
      { error: 'Questo nickname è già usato nella stanza.' },
      { status: 409 },
    );
  }

  if (error.code === 'P0001' && message.includes('full')) {
    return NextResponse.json(
      { error: 'La stanza ha raggiunto il numero massimo di giocatori.' },
      { status: 409 },
    );
  }

  if (error.code === 'P0001' && message.includes('avatar')) {
    return NextResponse.json(
      { error: 'Questo avatar è già occupato nella stanza.' },
      { status: 409 },
    );
  }

  if (error.code === 'P0001' && message.includes('lobby')) {
    return NextResponse.json(
      { error: 'La partita è già iniziata e non accetta nuovi giocatori.' },
      { status: 409 },
    );
  }

  if (error.code === '42501') {
    return NextResponse.json(
      { error: 'Sessione partecipante non valida. Riprova.' },
      { status: 401 },
    );
  }

  if (error.code === '22023' || error.code === '23514') {
    return NextResponse.json(
      { error: 'Controlla codice, nickname e avatar.' },
      { status: 400 },
    );
  }

  return NextResponse.json(
    { error: 'Impossibile entrare nella partita. Riprova.' },
    { status: 500 },
  );
}

export async function POST(request: NextRequest) {
  if (!hasValidRequestOrigin(request)) {
    return NextResponse.json(
      { error: 'Origine della richiesta non valida.' },
      { status: 403 },
    );
  }

  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return NextResponse.json(
      { error: 'Sessione partecipante non disponibile.' },
      { status: 401 },
    );
  }

  let body: unknown;

  try {
    body = (await request.json()) as unknown;
  } catch {
    return NextResponse.json(
      { error: 'Richiesta non valida.' },
      { status: 400 },
    );
  }

  const input = parseInput(body);

  if (!input) {
    return NextResponse.json(
      { error: 'Controlla codice, nickname e avatar.' },
      { status: 400 },
    );
  }

  try {
    const supabase = createClient(
      getRequiredEnvironmentVariable('NEXT_PUBLIC_SUPABASE_URL'),
      getRequiredEnvironmentVariable('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
        global: {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      },
    );
    const { data, error } = await supabase.rpc('join_game_session', {
      p_code: input.code,
      p_nickname: input.nickname,
      p_avatar_key: input.avatarKey,
    });

    if (error) {
      return rpcErrorResponse(error);
    }

    const row = Array.isArray(data) ? (data[0] as unknown) : null;

    if (!isJoinedGameRow(row)) {
      return NextResponse.json(
        { error: 'Risposta inattesa durante l’ingresso nella partita.' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      player: {
        nickname: row.player_nickname,
        avatarKey: row.player_avatar_key,
      },
      session: {
        code: row.session_code,
        title: row.quiz_title,
        phase: row.session_phase,
        participantCount: row.participant_count,
        maxPlayers: row.max_players,
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Configurazione Supabase non disponibile.' },
      { status: 500 },
    );
  }
}
