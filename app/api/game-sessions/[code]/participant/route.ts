import { type NextRequest, NextResponse } from 'next/server';

import { GAME_CODE_PATTERN, normalizeGameCode } from '@/lib/game/lobby';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyAnonymousParticipantRequest } from '@/lib/supabase/participant-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ParticipantRouteContext {
  readonly params: Promise<{ code: string }>;
}

export async function GET(
  request: NextRequest,
  context: ParticipantRouteContext,
) {
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

  try {
    const admin = createAdminClient();
    const sessionResult = await admin
      .from('game_sessions')
      .select('id,code,phase')
      .eq('code', code)
      .maybeSingle();

    if (sessionResult.error) {
      console.error('Supabase error finding participant session', {
        code: sessionResult.error.code,
        message: sessionResult.error.message,
        details: sessionResult.error.details,
        hint: sessionResult.error.hint,
      });
      return NextResponse.json(
        { error: 'Impossibile recuperare la stanza.' },
        { status: 500 },
      );
    }

    if (!sessionResult.data) {
      return NextResponse.json(
        { error: 'Stanza non trovata.' },
        { status: 404 },
      );
    }

    const playerResult = await admin
      .from('players')
      .select('nickname,avatar_key,total_score')
      .eq('game_session_id', sessionResult.data.id)
      .eq('auth_user_id', participant.userId)
      .maybeSingle();

    if (playerResult.error) {
      console.error('Supabase error finding current participant', {
        code: playerResult.error.code,
        message: playerResult.error.message,
        details: playerResult.error.details,
        hint: playerResult.error.hint,
      });
      return NextResponse.json(
        { error: 'Impossibile recuperare la partecipazione.' },
        { status: 500 },
      );
    }

    if (!playerResult.data) {
      return NextResponse.json(
        { error: 'Partecipazione non trovata.' },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        session: {
          code: sessionResult.data.code,
          phase: sessionResult.data.phase,
        },
        player: {
          nickname: playerResult.data.nickname,
          avatarKey: playerResult.data.avatar_key,
          score: playerResult.data.total_score,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      { error: 'Configurazione Supabase non disponibile.' },
      { status: 500 },
    );
  }
}
