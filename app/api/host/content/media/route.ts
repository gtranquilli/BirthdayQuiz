import { randomUUID } from 'node:crypto';

import { type NextRequest, NextResponse } from 'next/server';

import {
  QUIZ_MEDIA_BUCKET,
  QUIZ_MEDIA_MAX_BYTES,
  QUIZ_MEDIA_MIME_TYPES,
} from '@/lib/game/media';
import {
  HOST_SESSION_COOKIE_NAME,
  verifyHostSessionToken,
} from '@/lib/host/session';
import { hasValidRequestOrigin } from '@/lib/http/origin';
import { readImageMetadata } from '@/lib/server/image-metadata';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type MediaEntityType = 'question' | 'answer';

interface MediaTarget {
  readonly table: 'questions' | 'answer_options';
  readonly id: string;
  readonly quizId: string;
  readonly directory: 'questions' | 'answers';
  readonly previousPath: string | null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseEntityType(value: unknown): MediaEntityType | null {
  return value === 'question' || value === 'answer' ? value : null;
}

async function resolveTarget(
  admin: ReturnType<typeof createAdminClient>,
  entityType: MediaEntityType,
  entityId: string,
): Promise<MediaTarget | null> {
  let questionId = entityId;
  let previousPath: string | null = null;

  if (entityType === 'answer') {
    const answerResult = await admin
      .from('answer_options')
      .select('id,question_id,image_storage_path')
      .eq('id', entityId)
      .maybeSingle();

    if (answerResult.error) {
      throw answerResult.error;
    }

    if (!answerResult.data) {
      return null;
    }

    questionId = answerResult.data.question_id;
    previousPath = answerResult.data.image_storage_path;
  }

  const questionResult = await admin
    .from('questions')
    .select('id,category_id,image_storage_path')
    .eq('id', questionId)
    .maybeSingle();

  if (questionResult.error) {
    throw questionResult.error;
  }

  if (!questionResult.data) {
    return null;
  }

  if (entityType === 'question') {
    previousPath = questionResult.data.image_storage_path;
  }

  const categoryResult = await admin
    .from('quiz_categories')
    .select('quiz_id')
    .eq('id', questionResult.data.category_id)
    .maybeSingle();

  if (categoryResult.error) {
    throw categoryResult.error;
  }

  if (!categoryResult.data) {
    return null;
  }

  return {
    table: entityType === 'question' ? 'questions' : 'answer_options',
    id: entityId,
    quizId: categoryResult.data.quiz_id,
    directory: entityType === 'question' ? 'questions' : 'answers',
    previousPath,
  };
}

async function removeStorageObject(
  admin: ReturnType<typeof createAdminClient>,
  storagePath: string,
  preserveIfSnapshotted = false,
): Promise<void> {
  if (preserveIfSnapshotted) {
    const [questionReferences, answerReferences] = await Promise.all([
      admin
        .from('game_questions')
        .select('id', { count: 'exact', head: true })
        .eq('image_storage_path', storagePath),
      admin
        .from('game_answer_options')
        .select('id', { count: 'exact', head: true })
        .eq('image_storage_path', storagePath),
    ]);

    if (questionReferences.error || answerReferences.error) {
      console.error('Supabase error checking quiz media snapshot references', {
        questionError: questionReferences.error?.message,
        answerError: answerReferences.error?.message,
      });
      return;
    }

    if ((questionReferences.count ?? 0) > 0 || (answerReferences.count ?? 0) > 0) {
      return;
    }
  }

  const result = await admin.storage.from(QUIZ_MEDIA_BUCKET).remove([storagePath]);

  if (result.error) {
    console.error('Supabase Storage error removing quiz media', {
      message: result.error.message,
      name: result.error.name,
    });
  }
}

export async function POST(request: NextRequest) {
  if (!hasValidRequestOrigin(request)) {
    return NextResponse.json(
      { error: 'Origine della richiesta non valida.' },
      { status: 403 },
    );
  }

  if (!isAuthenticated(request)) {
    return invalidSessionResponse();
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Upload non valido.' }, { status: 400 });
  }

  const entityType = parseEntityType(formData.get('entityType'));
  const entityId = formData.get('entityId');
  const altTextValue = formData.get('altText');
  const file = formData.get('file');
  const altText = typeof altTextValue === 'string' ? altTextValue.trim() : '';

  if (
    !entityType ||
    typeof entityId !== 'string' ||
    !UUID_PATTERN.test(entityId) ||
    !(file instanceof File) ||
    altText.length < 1 ||
    altText.length > 500
  ) {
    return NextResponse.json(
      { error: 'Seleziona un file e inserisci un testo alternativo valido.' },
      { status: 400 },
    );
  }

  if (file.size < 1 || file.size > QUIZ_MEDIA_MAX_BYTES) {
    return NextResponse.json(
      { error: 'L’immagine deve avere una dimensione massima di 5 MB.' },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const metadata = readImageMetadata(bytes);

  if (
    !metadata ||
    !QUIZ_MEDIA_MIME_TYPES.includes(
      file.type as (typeof QUIZ_MEDIA_MIME_TYPES)[number],
    ) ||
    metadata.mimeType !== file.type
  ) {
    return NextResponse.json(
      { error: 'Formato non supportato. Usa JPEG, PNG o WebP validi.' },
      { status: 415 },
    );
  }

  try {
    const admin = createAdminClient();
    const target = await resolveTarget(admin, entityType, entityId);

    if (!target) {
      return NextResponse.json(
        { error: 'Contenuto non trovato.' },
        { status: 404 },
      );
    }

    const storagePath = `quizzes/${target.quizId}/${target.directory}/${target.id}/${Date.now()}-${randomUUID()}.${metadata.extension}`;
    const uploadResult = await admin.storage
      .from(QUIZ_MEDIA_BUCKET)
      .upload(storagePath, bytes, {
        cacheControl: '3600',
        contentType: metadata.mimeType,
        upsert: false,
      });

    if (uploadResult.error) {
      console.error('Supabase Storage error uploading quiz media', {
        message: uploadResult.error.message,
        name: uploadResult.error.name,
      });
      return NextResponse.json(
        { error: 'Impossibile caricare l’immagine.' },
        { status: 502 },
      );
    }

    const updatedAt = new Date().toISOString();
    const updateResult = await admin
      .from(target.table)
      .update({
        image_storage_path: storagePath,
        image_alt_text: altText,
        image_width: metadata.width,
        image_height: metadata.height,
        image_updated_at: updatedAt,
      })
      .eq('id', target.id);

    if (updateResult.error) {
      await removeStorageObject(admin, storagePath);
      console.error('Supabase error saving quiz media metadata', {
        code: updateResult.error.code,
        message: updateResult.error.message,
        details: updateResult.error.details,
        hint: updateResult.error.hint,
      });
      return NextResponse.json(
        { error: 'Impossibile salvare i metadati dell’immagine.' },
        { status: 500 },
      );
    }

    if (target.previousPath && target.previousPath !== storagePath) {
      await removeStorageObject(admin, target.previousPath, true);
    }

    return NextResponse.json({
      media: {
        storagePath,
        altText,
        width: metadata.width,
        height: metadata.height,
        updatedAt,
      },
    });
  } catch (error) {
    console.error('Unexpected quiz media upload error', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Impossibile completare l’upload.' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!hasValidRequestOrigin(request)) {
    return NextResponse.json(
      { error: 'Origine della richiesta non valida.' },
      { status: 403 },
    );
  }

  if (!isAuthenticated(request)) {
    return invalidSessionResponse();
  }

  let body: unknown;

  try {
    body = (await request.json()) as unknown;
  } catch {
    return NextResponse.json({ error: 'Richiesta non valida.' }, { status: 400 });
  }

  const entityType = isRecord(body) ? parseEntityType(body.entityType) : null;
  const entityId = isRecord(body) ? body.entityId : null;

  if (!entityType || typeof entityId !== 'string' || !UUID_PATTERN.test(entityId)) {
    return NextResponse.json({ error: 'Contenuto non valido.' }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const target = await resolveTarget(admin, entityType, entityId);

    if (!target) {
      return NextResponse.json(
        { error: 'Contenuto non trovato.' },
        { status: 404 },
      );
    }

    if (!target.previousPath) {
      return NextResponse.json({ removed: true });
    }

    const updateResult = await admin
      .from(target.table)
      .update({
        image_storage_path: null,
        image_alt_text: null,
        image_width: null,
        image_height: null,
        image_updated_at: null,
      })
      .eq('id', target.id);

    if (updateResult.error) {
      const message =
        updateResult.error.code === '23514'
          ? 'Non puoi rimuovere l’immagine da un contenuto senza testo.'
          : 'Impossibile rimuovere l’immagine.';
      return NextResponse.json(
        { error: message },
        { status: updateResult.error.code === '23514' ? 409 : 500 },
      );
    }

    await removeStorageObject(admin, target.previousPath, true);
    return NextResponse.json({ removed: true });
  } catch {
    return NextResponse.json(
      { error: 'Impossibile rimuovere l’immagine.' },
      { status: 500 },
    );
  }
}
