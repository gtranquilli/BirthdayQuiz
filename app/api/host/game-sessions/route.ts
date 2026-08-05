import { type NextRequest, NextResponse } from 'next/server';

import {
  HOST_SESSION_COOKIE_NAME,
  verifyHostSessionToken,
} from '@/lib/host/session';
import { hasValidRequestOrigin } from '@/lib/http/origin';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface CategoryConfigurationInput {
  readonly categoryId: string;
  readonly questionCount: number;
}

interface CreateGameSessionInput {
  readonly quizId: string;
  readonly presetId: string | null;
  readonly maxPlayers: number;
  readonly categoryConfig: readonly CategoryConfigurationInput[];
}

interface CreatedSessionRow {
  readonly game_session_id: string;
  readonly session_code: string;
  readonly quiz_title: string;
  readonly max_players: number;
}

interface GameSessionSummaryRow {
  readonly id: string;
  readonly code: string;
  readonly quiz_title: string;
  readonly phase: string;
  readonly participant_count: number;
  readonly max_players: number;
  readonly created_at: string;
  readonly updated_at: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function parseInput(value: unknown): CreateGameSessionInput | null {
  if (
    !isRecord(value) ||
    !isUuid(value.quizId) ||
    !(value.presetId === null || isUuid(value.presetId)) ||
    typeof value.maxPlayers !== 'number' ||
    !Number.isInteger(value.maxPlayers) ||
    value.maxPlayers <= 0 ||
    !Array.isArray(value.categoryConfig) ||
    value.categoryConfig.length === 0
  ) {
    return null;
  }

  const categoryConfig: CategoryConfigurationInput[] = [];
  const categoryIds = new Set<string>();
  let totalQuestions = 0;

  for (const item of value.categoryConfig) {
    if (
      !isRecord(item) ||
      !isUuid(item.categoryId) ||
      typeof item.questionCount !== 'number' ||
      !Number.isInteger(item.questionCount) ||
      item.questionCount < 0 ||
      categoryIds.has(item.categoryId)
    ) {
      return null;
    }

    categoryIds.add(item.categoryId);
    totalQuestions += item.questionCount;
    categoryConfig.push({
      categoryId: item.categoryId,
      questionCount: item.questionCount,
    });
  }

  if (totalQuestions <= 0 || totalQuestions > 32767) {
    return null;
  }

  return {
    quizId: value.quizId,
    presetId: value.presetId,
    maxPlayers: value.maxPlayers,
    categoryConfig,
  };
}

function isCreatedSessionRow(value: unknown): value is CreatedSessionRow {
  return (
    isRecord(value) &&
    isUuid(value.game_session_id) &&
    typeof value.session_code === 'string' &&
    typeof value.quiz_title === 'string' &&
    typeof value.max_players === 'number'
  );
}

function databaseErrorResponse(code: string | undefined) {
  if (code === '40001') {
    return NextResponse.json(
      { error: 'I contenuti sono cambiati durante la creazione. Riprova.' },
      { status: 409 },
    );
  }

  if (code === '22023' || code === 'P0002') {
    return NextResponse.json(
      { error: 'Configurazione non valida o contenuti non disponibili.' },
      { status: 400 },
    );
  }

  if (code === '23514') {
    return NextResponse.json(
      { error: 'Il quiz contiene una domanda incompleta.' },
      { status: 422 },
    );
  }

  return NextResponse.json(
    { error: 'Impossibile creare la partita.' },
    { status: 500 },
  );
}

export async function GET(request: NextRequest) {
  const authenticated = verifyHostSessionToken(
    request.cookies.get(HOST_SESSION_COOKIE_NAME)?.value,
  );

  if (!authenticated) {
    return NextResponse.json(
      { error: 'Sessione host non valida o scaduta.' },
      { status: 401 },
    );
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('game_sessions')
      .select(
        'id,code,quiz_title,phase,participant_count,max_players,created_at,updated_at',
      )
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('Supabase error in GET /api/host/game-sessions', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      return NextResponse.json(
        { error: 'Impossibile caricare le stanze recenti.' },
        { status: 500 },
      );
    }

    const sessions = ((data ?? []) as GameSessionSummaryRow[]).map(
      (session) => ({
        id: session.id,
        code: session.code,
        title: session.quiz_title,
        phase: session.phase,
        participantCount: session.participant_count,
        maxPlayers: session.max_players,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
      }),
    );

    return NextResponse.json(
      { sessions },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      { error: 'Configurazione Supabase server non disponibile.' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
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

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Richiesta non valida.' },
      { status: 400 },
    );
  }

  const input = parseInput(body);

  if (!input) {
    return NextResponse.json(
      { error: 'Controlla quiz, preset, domande e numero massimo giocatori.' },
      { status: 400 },
    );
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('create_game_session', {
      p_quiz_id: input.quizId,
      p_preset_id: input.presetId,
      p_max_players: input.maxPlayers,
      p_category_config: input.categoryConfig.map((item) => ({
        category_id: item.categoryId,
        question_count: item.questionCount,
      })),
    });

    if (error) {
      return databaseErrorResponse(error.code);
    }

    const row = Array.isArray(data) ? (data[0] as unknown) : null;

    if (!isCreatedSessionRow(row)) {
      return NextResponse.json(
        { error: 'Risposta inattesa durante la creazione della partita.' },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        session: {
          id: row.game_session_id,
          code: row.session_code,
          title: row.quiz_title,
          maxPlayers: row.max_players,
        },
      },
      { status: 201 },
    );
  } catch {
    return NextResponse.json(
      { error: 'Configurazione Supabase server non disponibile.' },
      { status: 500 },
    );
  }
}
