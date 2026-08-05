export const QUIZ_MEDIA_BUCKET = 'quiz-media';
export const QUIZ_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const QUIZ_MEDIA_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const QUIZ_MEDIA_PATH_PATTERN =
  /^quizzes\/[0-9a-f-]{36}\/(?:questions|answers)\/[0-9a-f-]{36}\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpg|jpeg|png|webp)$/;

export interface QuizMedia {
  readonly storagePath: string;
  readonly altText: string;
  readonly width: number;
  readonly height: number;
  readonly updatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isQuizMediaStoragePath(value: unknown): value is string {
  return typeof value === 'string' && QUIZ_MEDIA_PATH_PATTERN.test(value);
}

export function parseQuizMediaFields(
  value: Record<string, unknown>,
): QuizMedia | null | undefined {
  const fields = [
    value.image_storage_path,
    value.image_alt_text,
    value.image_width,
    value.image_height,
    value.image_updated_at,
  ];

  if (fields.every((field) => field === null || field === undefined)) {
    return null;
  }

  if (
    !isQuizMediaStoragePath(value.image_storage_path) ||
    typeof value.image_alt_text !== 'string' ||
    value.image_alt_text.trim().length === 0 ||
    typeof value.image_width !== 'number' ||
    !Number.isInteger(value.image_width) ||
    value.image_width <= 0 ||
    typeof value.image_height !== 'number' ||
    !Number.isInteger(value.image_height) ||
    value.image_height <= 0 ||
    typeof value.image_updated_at !== 'string' ||
    Number.isNaN(Date.parse(value.image_updated_at))
  ) {
    return undefined;
  }

  return {
    storagePath: value.image_storage_path,
    altText: value.image_alt_text.trim(),
    width: value.image_width,
    height: value.image_height,
    updatedAt: value.image_updated_at,
  };
}

export function parseQuizMedia(value: unknown): QuizMedia | null {
  if (!isRecord(value)) {
    return null;
  }

  return parseQuizMediaFields(value) ?? null;
}

export function getQuizMediaPublicUrl(storagePath: string): string | null {
  if (!isQuizMediaStoragePath(storagePath)) {
    return null;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();

  if (!supabaseUrl) {
    return null;
  }

  try {
    const path = storagePath
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');

    return new URL(
      `/storage/v1/object/public/${QUIZ_MEDIA_BUCKET}/${path}`,
      supabaseUrl,
    ).toString();
  } catch {
    return null;
  }
}
