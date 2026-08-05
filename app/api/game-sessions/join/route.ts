import { type NextRequest, NextResponse } from 'next/server';

import { isAvatarKey } from '@/lib/game/avatars';
import { GAME_CODE_PATTERN, normalizeGameCode } from '@/lib/game/lobby';
import { hasValidRequestOrigin } from '@/lib/http/origin';
import {
  generateRejoinToken,
  hashRejoinToken,
} from '@/lib/server/rejoin-token';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyAnonymousParticipantRequest } from '@/lib/supabase/participant-auth';

export const runtime = 'nodejs';

interface JoinGameInput {
  readonly code: string;
  readonly nickname: string;
  readonly avatarKey: string;
  readonly rotateRejoinToken: boolean;
}

interface JoinedGameRow {
  readonly session_code: string;
  readonly player_nickname: string;
  readonly player_avatar_key: string;
  readonly session_phase: string;
  readonly quiz_title: string;
  readonly max_players: number;
  readonly participant_count: number;
  readonly rejoin_token_changed: boolean;
}

interface SupabaseRpcError {
  readonly code?: string;
  readonly message?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseInput(value: unknown): JoinGameInput | null {
  if (
    !isRecord(value) ||
    typeof value.code !== 'string' ||
    typeof value.nickname !== 'string' ||
    !isAvatarKey(value.avatarKey) ||
    !(
      value.rotateRejoinToken === undefined ||
      typeof value.rotateRejoinToken === 'boolean'
    )
  ) {
    return null;
  }

  const code = normalizeGameCode(value.code);
  const nickname = value.nickname.trim().replace(/\s+/g, ' ');

  if (!GAME_CODE_PATTERN.test(code) || nickname.length < 2 || nickname.length > 20) {
    return null;
  }

  return {
    code,
    nickname,
    avatarKey: value.avatarKey,
    rotateRejoinToken: value.rotateRejoinToken ?? true,
  };
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
    typeof value.participant_count === 'number' &&
    typeof value.rejoin_token_changed === 'boolean'
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

  if (error.code === '23505' && message.includes('avatar')) {
    return NextResponse.json(
      { error: 'Questo avatar è già occupato nella stanza.' },
      { status: 409 },
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

  const participant = await verifyAnonymousParticipantRequest(request);

  if (!participant) {
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
    const rejoinToken = generateRejoinToken();
    const admin = createAdminClient();
    const { data, error } = await admin.rpc(
      'join_game_session_with_rejoin_token',
      {
        p_code: input.code,
        p_nickname: input.nickname,
        p_avatar_key: input.avatarKey,
        p_auth_user_id: participant.userId,
        p_rejoin_token_hash: hashRejoinToken(rejoinToken),
        p_rotate_rejoin_token: input.rotateRejoinToken,
      },
    );

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
      rejoinToken: row.rejoin_token_changed ? rejoinToken : null,
    });
  } catch {
    return NextResponse.json(
      { error: 'Configurazione Supabase non disponibile.' },
      { status: 500 },
    );
  }
}
