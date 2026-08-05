import { type NextRequest, NextResponse } from 'next/server';

import { GAME_CODE_PATTERN, normalizeGameCode } from '@/lib/game/lobby';
import {
  HOST_SESSION_COOKIE_NAME,
  verifyHostSessionToken,
} from '@/lib/host/session';
import { hasValidRequestOrigin } from '@/lib/http/origin';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface GameSessionRow {
  readonly id: string;
  readonly code: string;
  readonly quiz_title: string;
  readonly preset_name: string;
  readonly phase: string;
  readonly participant_count: number;
  readonly max_players: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface PlayerRow {
  readonly id: string;
  readonly nickname: string;
  readonly avatar_key: string;
  readonly joined_at: string;
}

interface GameSessionRouteContext {
  readonly params: Promise<{ code: string }>;
}

function isAuthenticated(request: NextRequest): boolean {
  return verifyHostSessionToken(
    request.cookies.get(HOST_SESSION_COOKIE_NAME)?.value,
  );
}

function invalidSessionResponse() {
  return NextResponse.json(
    { error: 'Sessione host non valida o scaduta.' },
    { status: 401 },
  );
}

function databaseMutationError(code: string | undefined) {
  if (code === 'P0002') {
    return NextResponse.json(
      { error: 'Stanza non trovata.' },
      { status: 404 },
    );
  }

  if (code === 'P0001') {
    return NextResponse.json(
      { error: 'La stanza può essere annullata soltanto durante la lobby.' },
      { status: 409 },
    );
  }

  return NextResponse.json(
    { error: 'Impossibile annullare la stanza.' },
    { status: 500 },
  );
}

export async function GET(
  request: NextRequest,
  context: GameSessionRouteContext,
) {
  if (!isAuthenticated(request)) {
    return invalidSessionResponse();
  }

  const { code: rawCode } = await context.params;
  const code = normalizeGameCode(rawCode);

  if (!GAME_CODE_PATTERN.test(code)) {
    return NextResponse.json(
      { error: 'Codice stanza non valido.' },
      { status: 400 },
    );
  }

  try {
    const admin = createAdminClient();
    const sessionResult = await admin
      .from('game_sessions')
      .select(
        'id,code,quiz_title,preset_name,phase,participant_count,max_players,created_at,updated_at',
      )
      .eq('code', code)
      .maybeSingle();

    if (sessionResult.error) {
      return NextResponse.json(
        { error: 'Impossibile caricare la stanza.' },
        { status: 500 },
      );
    }

    if (!sessionResult.data) {
      return NextResponse.json(
        { error: 'Stanza non trovata.' },
        { status: 404 },
      );
    }

    const session = sessionResult.data as GameSessionRow;
    const playersResult = await admin
      .from('players')
      .select('id,nickname,avatar_key,joined_at')
      .eq('game_session_id', session.id)
      .order('joined_at');

    if (playersResult.error) {
      return NextResponse.json(
        { error: 'Impossibile caricare i giocatori.' },
        { status: 500 },
      );
    }

    const players = ((playersResult.data ?? []) as PlayerRow[]).map(
      (player) => ({
        id: player.id,
        nickname: player.nickname,
        avatarKey: player.avatar_key,
        joinedAt: player.joined_at,
      }),
    );

    return NextResponse.json(
      {
        session: {
          id: session.id,
          code: session.code,
          title: session.quiz_title,
          presetName: session.preset_name,
          phase: session.phase,
          participantCount: session.participant_count,
          maxPlayers: session.max_players,
          createdAt: session.created_at,
          updatedAt: session.updated_at,
          players,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      { error: 'Configurazione Supabase server non disponibile.' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: GameSessionRouteContext,
) {
  if (!hasValidRequestOrigin(request)) {
    return NextResponse.json(
      { error: 'Origine della richiesta non valida.' },
      { status: 403 },
    );
  }

  if (!isAuthenticated(request)) {
    return invalidSessionResponse();
  }

  const { code: rawCode } = await context.params;
  const code = normalizeGameCode(rawCode);

  if (!GAME_CODE_PATTERN.test(code)) {
    return NextResponse.json(
      { error: 'Codice stanza non valido.' },
      { status: 400 },
    );
  }

  try {
    const admin = createAdminClient();
    const sessionResult = await admin
      .from('game_sessions')
      .select('id')
      .eq('code', code)
      .maybeSingle();

    if (sessionResult.error) {
      return NextResponse.json(
        { error: 'Impossibile trovare la stanza.' },
        { status: 500 },
      );
    }

    if (!sessionResult.data) {
      return NextResponse.json(
        { error: 'Stanza non trovata.' },
        { status: 404 },
      );
    }

    const { error } = await admin.rpc('cancel_lobby_session', {
      p_game_session_id: sessionResult.data.id,
    });

    if (error) {
      return databaseMutationError(error.code);
    }

    return NextResponse.json({ cancelled: true, code });
  } catch {
    return NextResponse.json(
      { error: 'Configurazione Supabase server non disponibile.' },
      { status: 500 },
    );
  }
}
