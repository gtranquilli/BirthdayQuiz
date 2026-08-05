import { type NextRequest, NextResponse } from 'next/server';

import { GAME_CODE_PATTERN, normalizeGameCode } from '@/lib/game/lobby';
import {
  HOST_SESSION_COOKIE_NAME,
  verifyHostSessionToken,
} from '@/lib/host/session';
import { hasValidRequestOrigin } from '@/lib/http/origin';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

interface AdvanceRouteContext {
  readonly params: Promise<{ code: string }>;
}

interface AdvanceGameRow {
  readonly session_code: string;
  readonly session_phase: 'voting_open' | 'finished';
  readonly current_question_index: number;
  readonly total_question_count: number;
  readonly leaderboard: readonly unknown[];
  readonly current_question: Record<string, unknown> | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAdvanceGameRow(value: unknown): value is AdvanceGameRow {
  return (
    isRecord(value) &&
    typeof value.session_code === 'string' &&
    (value.session_phase === 'voting_open' ||
      value.session_phase === 'finished') &&
    typeof value.current_question_index === 'number' &&
    Number.isInteger(value.current_question_index) &&
    typeof value.total_question_count === 'number' &&
    Number.isInteger(value.total_question_count) &&
    value.total_question_count > 0 &&
    value.current_question_index >= 0 &&
    value.current_question_index < value.total_question_count &&
    Array.isArray(value.leaderboard) &&
    (value.current_question === null || isRecord(value.current_question)) &&
    (value.session_phase === 'finished'
      ? value.current_question === null &&
        value.current_question_index === value.total_question_count - 1
      : isRecord(value.current_question))
  );
}

function databaseErrorResponse(code: string | undefined) {
  if (code === 'P0002') {
    return NextResponse.json({ error: 'Stanza non trovata.' }, { status: 404 });
  }

  if (code === 'P0001') {
    return NextResponse.json(
      {
        error:
          'Il punteggio può essere confermato soltanto dopo il reveal e una sola volta.',
      },
      { status: 409 },
    );
  }

  if (code === '22023' || code === '23514') {
    return NextResponse.json(
      { error: 'I dati della domanda corrente non sono completi.' },
      { status: 422 },
    );
  }

  return NextResponse.json(
    { error: 'Impossibile assegnare il punteggio e avanzare.' },
    { status: 500 },
  );
}

export async function POST(
  request: NextRequest,
  context: AdvanceRouteContext,
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
      console.error('Supabase error finding session before advance', {
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

    const { data, error } = await admin.rpc(
      'score_and_advance_game_session',
      { p_game_session_id: sessionResult.data.id },
    );

    if (error) {
      console.error('Supabase error in score_and_advance_game_session', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      return databaseErrorResponse(error.code);
    }

    const row = Array.isArray(data) ? (data[0] as unknown) : null;

    if (!isAdvanceGameRow(row)) {
      return NextResponse.json(
        { error: 'Risposta inattesa durante l’avanzamento.' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      session: {
        code: row.session_code,
        phase: row.session_phase,
        currentQuestionIndex: row.current_question_index,
        totalQuestionCount: row.total_question_count,
        leaderboard: row.leaderboard,
        currentQuestion: row.current_question,
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Configurazione Supabase server non disponibile.' },
      { status: 500 },
    );
  }
}
