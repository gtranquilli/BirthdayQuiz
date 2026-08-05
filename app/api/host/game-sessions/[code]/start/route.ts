import { type NextRequest, NextResponse } from 'next/server';

import { isAnswerPosition } from '@/lib/game/answer-position';
import { GAME_CODE_PATTERN, normalizeGameCode } from '@/lib/game/lobby';
import {
  HOST_SESSION_COOKIE_NAME,
  verifyHostSessionToken,
} from '@/lib/host/session';
import { hasValidRequestOrigin } from '@/lib/http/origin';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

interface StartRouteContext {
  readonly params: Promise<{ code: string }>;
}

interface StartGameOptionRow {
  readonly id: string;
  readonly text: string | null;
  readonly position: number;
}

interface StartGameRow {
  readonly session_code: string;
  readonly session_phase: 'voting_open';
  readonly question_index: number;
  readonly total_questions: number;
  readonly question_id: string;
  readonly question_position: number;
  readonly question_category: string;
  readonly question_prompt: string | null;
  readonly question_options: readonly StartGameOptionRow[];
  readonly received_votes: number;
}

interface StartGameResponse {
  readonly session: {
    readonly code: string;
    readonly phase: 'voting_open';
    readonly currentQuestionIndex: number;
    readonly totalQuestionCount: number;
    readonly currentQuestion: {
      readonly id: string;
      readonly position: number;
      readonly category: string;
      readonly prompt: string | null;
      readonly options: readonly StartGameOptionRow[];
    };
    readonly votedCount: number;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStartGameRow(value: unknown): value is StartGameRow {
  if (
    !isRecord(value) ||
    typeof value.session_code !== 'string' ||
    value.session_phase !== 'voting_open' ||
    typeof value.question_index !== 'number' ||
    typeof value.total_questions !== 'number' ||
    typeof value.question_id !== 'string' ||
    typeof value.question_position !== 'number' ||
    typeof value.question_category !== 'string' ||
    !(
      value.question_prompt === null ||
      typeof value.question_prompt === 'string'
    ) ||
    typeof value.received_votes !== 'number' ||
    !Array.isArray(value.question_options) ||
    value.question_options.length !== 4
  ) {
    return false;
  }

  return value.question_options.every(
    (option) =>
      isRecord(option) &&
      typeof option.id === 'string' &&
      (option.text === null || typeof option.text === 'string') &&
      isAnswerPosition(option.position),
  );
}

function databaseErrorResponse(code: string | undefined, message: string) {
  if (code === 'P0002') {
    return NextResponse.json({ error: 'Stanza non trovata.' }, { status: 404 });
  }

  if (code === 'P0001') {
    if (message.includes('At least one participant')) {
      return NextResponse.json(
        { error: 'Serve almeno un partecipante per avviare il quiz.' },
        { status: 409 },
      );
    }

    if (message.includes('only be started from the lobby')) {
      return NextResponse.json(
        { error: 'Il quiz può essere avviato soltanto dalla lobby.' },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        error:
          'Le domande disponibili non bastano o la configurazione non è più valida.',
      },
      { status: 422 },
    );
  }

  if (code === '23514') {
    return NextResponse.json(
      { error: 'Il quiz contiene una domanda o uno snapshot incompleto.' },
      { status: 422 },
    );
  }

  if (code === '40001') {
    return NextResponse.json(
      { error: 'I contenuti sono cambiati durante l’avvio. Riprova.' },
      { status: 409 },
    );
  }

  if (code === '22023') {
    return NextResponse.json(
      { error: 'La richiesta di avvio non è valida.' },
      { status: 400 },
    );
  }

  return NextResponse.json(
    { error: 'Impossibile avviare il quiz.' },
    { status: 500 },
  );
}

export async function POST(
  request: NextRequest,
  context: StartRouteContext,
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

    const { data, error } = await admin.rpc('start_game_session', {
      p_game_session_id: sessionResult.data.id,
    });

    if (error) {
      console.error('Supabase error in start_game_session', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      return databaseErrorResponse(error.code, error.message);
    }

    const row = Array.isArray(data) ? (data[0] as unknown) : null;

    if (!isStartGameRow(row)) {
      return NextResponse.json(
        { error: 'Risposta inattesa durante l’avvio del quiz.' },
        { status: 500 },
      );
    }

    const response: StartGameResponse = {
      session: {
        code: row.session_code,
        phase: row.session_phase,
        currentQuestionIndex: row.question_index,
        totalQuestionCount: row.total_questions,
        currentQuestion: {
          id: row.question_id,
          position: row.question_position,
          category: row.question_category,
          prompt: row.question_prompt,
          options: row.question_options,
        },
        votedCount: row.received_votes,
      },
    };

    return NextResponse.json(response);
  } catch {
    return NextResponse.json(
      { error: 'Configurazione Supabase server non disponibile.' },
      { status: 500 },
    );
  }
}
