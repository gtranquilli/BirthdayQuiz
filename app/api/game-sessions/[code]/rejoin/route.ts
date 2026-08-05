import { type NextRequest, NextResponse } from 'next/server';

import { GAME_CODE_PATTERN, normalizeGameCode } from '@/lib/game/lobby';
import { hasValidRequestOrigin } from '@/lib/http/origin';
import {
  generateRejoinToken,
  hashRejoinToken,
  isValidRejoinToken,
} from '@/lib/server/rejoin-token';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyAnonymousParticipantRequest } from '@/lib/supabase/participant-auth';

export const runtime = 'nodejs';

interface RejoinRouteContext {
  readonly params: Promise<{ code: string }>;
}

interface RejoinRow {
  readonly session_code: string;
  readonly player_nickname: string;
  readonly player_avatar_key: string;
  readonly total_score: number;
  readonly session_phase: string;
  readonly participant_count: number;
  readonly max_players: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseRejoinToken(value: unknown): string | null {
  return isRecord(value) && isValidRejoinToken(value.rejoinToken)
    ? value.rejoinToken
    : null;
}

function isRejoinRow(value: unknown): value is RejoinRow {
  return (
    isRecord(value) &&
    typeof value.session_code === 'string' &&
    typeof value.player_nickname === 'string' &&
    typeof value.player_avatar_key === 'string' &&
    typeof value.total_score === 'number' &&
    typeof value.session_phase === 'string' &&
    typeof value.participant_count === 'number' &&
    typeof value.max_players === 'number'
  );
}

export async function POST(
  request: NextRequest,
  context: RejoinRouteContext,
) {
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

  const { code: rawCode } = await context.params;
  const code = normalizeGameCode(rawCode);

  if (!GAME_CODE_PATTERN.test(code)) {
    return NextResponse.json(
      { error: 'Codice stanza non valido.' },
      { status: 400 },
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

  const currentRejoinToken = parseRejoinToken(body);

  if (!currentRejoinToken) {
    return NextResponse.json(
      { error: 'Token di recupero non valido.' },
      { status: 400 },
    );
  }

  try {
    const nextRejoinToken = generateRejoinToken();
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('rejoin_game_session', {
      p_code: code,
      p_rejoin_token_hash: hashRejoinToken(currentRejoinToken),
      p_new_auth_user_id: participant.userId,
      p_new_rejoin_token_hash: hashRejoinToken(nextRejoinToken),
    });

    if (error) {
      console.error('Supabase error in rejoin_game_session', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });

      if (error.code === 'P0002') {
        return NextResponse.json(
          { error: 'Non è stato possibile recuperare la partecipazione precedente.' },
          { status: 404 },
        );
      }

      if (error.code === 'P0001') {
        return NextResponse.json(
          { error: 'Questa identità è già associata a un altro partecipante.' },
          { status: 409 },
        );
      }

      return NextResponse.json(
        { error: 'Impossibile recuperare la partecipazione.' },
        { status: 500 },
      );
    }

    const row = Array.isArray(data) ? (data[0] as unknown) : null;

    if (!isRejoinRow(row)) {
      return NextResponse.json(
        { error: 'Risposta inattesa durante il recupero.' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      session: {
        code: row.session_code,
        phase: row.session_phase,
        participantCount: row.participant_count,
        maxPlayers: row.max_players,
      },
      player: {
        nickname: row.player_nickname,
        avatarKey: row.player_avatar_key,
        score: row.total_score,
      },
      rejoinToken: nextRejoinToken,
    });
  } catch {
    return NextResponse.json(
      { error: 'Configurazione Supabase non disponibile.' },
      { status: 500 },
    );
  }
}
