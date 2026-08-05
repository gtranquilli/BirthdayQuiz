import { type NextRequest, NextResponse } from 'next/server';

import { GAME_CODE_PATTERN, normalizeGameCode } from '@/lib/game/lobby';
import {
  HOST_SESSION_COOKIE_NAME,
  verifyHostSessionToken,
} from '@/lib/host/session';
import { hasValidRequestOrigin } from '@/lib/http/origin';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

interface CloseRouteContext {
  readonly params: Promise<{ code: string }>;
}

interface CloseVotingRow {
  readonly session_code: string;
  readonly session_phase: 'voting_closed';
  readonly current_question_index: number;
  readonly received_votes: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCloseVotingRow(value: unknown): value is CloseVotingRow {
  return (
    isRecord(value) &&
    typeof value.session_code === 'string' &&
    value.session_phase === 'voting_closed' &&
    typeof value.current_question_index === 'number' &&
    typeof value.received_votes === 'number'
  );
}

function databaseErrorResponse(code: string | undefined) {
  if (code === 'P0002') {
    return NextResponse.json({ error: 'Stanza non trovata.' }, { status: 404 });
  }

  if (code === 'P0001') {
    return NextResponse.json(
      { error: 'I voti possono essere chiusi soltanto durante la votazione.' },
      { status: 409 },
    );
  }

  if (code === '22023' || code === '23514') {
    return NextResponse.json(
      { error: 'La domanda corrente non è valida.' },
      { status: 422 },
    );
  }

  return NextResponse.json(
    { error: 'Impossibile chiudere la votazione.' },
    { status: 500 },
  );
}

export async function POST(
  request: NextRequest,
  context: CloseRouteContext,
) {
  if (!hasValidRequestOrigin(request)) {
    return NextResponse.json(
      { error: 'Origine della richiesta non valida.' },
      { status: 403 },
    );
  }

  const authenticated = verifyHostSessionToken(
    request.cookies.get(HOST_SESSION_COOKIE_NAME)?.value,
  );

  if (!authenticated) {
    return NextResponse.json(
      { error: 'Sessione host non valida o scaduta.' },
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
      .select('id')
      .eq('code', code)
      .maybeSingle();

    if (sessionResult.error) {
      console.error('Supabase error finding session before close', {
        code: sessionResult.error.code,
        message: sessionResult.error.message,
        details: sessionResult.error.details,
        hint: sessionResult.error.hint,
      });
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

    const { data, error } = await admin.rpc('close_current_voting', {
      p_game_session_id: sessionResult.data.id,
    });

    if (error) {
      console.error('Supabase error in close_current_voting', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      return databaseErrorResponse(error.code);
    }

    const row = Array.isArray(data) ? (data[0] as unknown) : null;

    if (!isCloseVotingRow(row)) {
      return NextResponse.json(
        { error: 'Risposta inattesa durante la chiusura della votazione.' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      session: {
        code: row.session_code,
        phase: row.session_phase,
        currentQuestionIndex: row.current_question_index,
        votedCount: row.received_votes,
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Configurazione Supabase server non disponibile.' },
      { status: 500 },
    );
  }
}
