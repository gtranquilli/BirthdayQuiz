import { type NextRequest, NextResponse } from 'next/server';

import { GAME_CODE_PATTERN, normalizeGameCode } from '@/lib/game/lobby';
import {
  HOST_SESSION_COOKIE_NAME,
  verifyHostSessionToken,
} from '@/lib/host/session';
import { hasValidRequestOrigin } from '@/lib/http/origin';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface PlayerRouteContext {
  readonly params: Promise<{ code: string; playerId: string }>;
}

function databaseErrorResponse(code: string | undefined) {
  if (code === 'P0002') {
    return NextResponse.json(
      { error: 'Stanza o giocatore non trovato.' },
      { status: 404 },
    );
  }

  if (code === 'P0001') {
    return NextResponse.json(
      { error: 'I giocatori possono essere rimossi soltanto durante la lobby.' },
      { status: 409 },
    );
  }

  if (code === '23514') {
    return NextResponse.json(
      { error: 'Il conteggio partecipanti non è coerente.' },
      { status: 409 },
    );
  }

  return NextResponse.json(
    { error: 'Impossibile rimuovere il giocatore.' },
    { status: 500 },
  );
}

export async function DELETE(
  request: NextRequest,
  context: PlayerRouteContext,
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

  const { code: rawCode, playerId } = await context.params;
  const code = normalizeGameCode(rawCode);

  if (!GAME_CODE_PATTERN.test(code) || !UUID_PATTERN.test(playerId)) {
    return NextResponse.json(
      { error: 'Codice stanza o giocatore non valido.' },
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

    const { error } = await admin.rpc('remove_lobby_player', {
      p_game_session_id: sessionResult.data.id,
      p_player_id: playerId,
    });

    if (error) {
      return databaseErrorResponse(error.code);
    }

    return NextResponse.json({ removed: true, playerId });
  } catch {
    return NextResponse.json(
      { error: 'Configurazione Supabase server non disponibile.' },
      { status: 500 },
    );
  }
}
