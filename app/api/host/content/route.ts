import { type NextRequest, NextResponse } from 'next/server';

import {
  HOST_SESSION_COOKIE_NAME,
  verifyHostSessionToken,
} from '@/lib/host/session';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface MediaColumns {
  readonly image_storage_path: string | null;
  readonly image_alt_text: string | null;
  readonly image_width: number | null;
  readonly image_height: number | null;
  readonly image_updated_at: string | null;
}

interface QuizRow {
  readonly id: string;
  readonly title: string;
}

interface CategoryRow {
  readonly id: string;
  readonly quiz_id: string;
  readonly name: string;
  readonly position: number;
}

interface QuestionRow extends MediaColumns {
  readonly id: string;
  readonly category_id: string;
  readonly prompt: string | null;
}

interface AnswerRow extends MediaColumns {
  readonly id: string;
  readonly question_id: string;
  readonly position: number;
  readonly label: string | null;
}

function toMedia(row: MediaColumns) {
  if (!row.image_storage_path) {
    return null;
  }

  return {
    storagePath: row.image_storage_path,
    altText: row.image_alt_text,
    width: row.image_width,
    height: row.image_height,
    updatedAt: row.image_updated_at,
  };
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
    const [quizzesResult, categoriesResult, questionsResult, answersResult] =
      await Promise.all([
        admin.from('quizzes').select('id,title').order('title'),
        admin
          .from('quiz_categories')
          .select('id,quiz_id,name,position')
          .order('quiz_id')
          .order('position'),
        admin
          .from('questions')
          .select(
            'id,category_id,prompt,image_storage_path,image_alt_text,image_width,image_height,image_updated_at',
          )
          .order('created_at'),
        admin
          .from('answer_options')
          .select(
            'id,question_id,position,label,image_storage_path,image_alt_text,image_width,image_height,image_updated_at',
          )
          .order('question_id')
          .order('position'),
      ]);

    const firstError = [
      quizzesResult.error,
      categoriesResult.error,
      questionsResult.error,
      answersResult.error,
    ].find(Boolean);

    if (firstError) {
      console.error('Supabase error loading host content media', {
        code: firstError.code,
        message: firstError.message,
        details: firstError.details,
        hint: firstError.hint,
      });
      return NextResponse.json(
        { error: 'Impossibile caricare i contenuti del quiz.' },
        { status: 500 },
      );
    }

    const quizzes = (quizzesResult.data ?? []) as QuizRow[];
    const categories = (categoriesResult.data ?? []) as CategoryRow[];
    const questions = (questionsResult.data ?? []) as QuestionRow[];
    const answers = (answersResult.data ?? []) as AnswerRow[];

    return NextResponse.json(
      {
        quizzes: quizzes.map((quiz) => ({
          id: quiz.id,
          title: quiz.title,
          categories: categories
            .filter((category) => category.quiz_id === quiz.id)
            .map((category) => ({
              id: category.id,
              name: category.name,
              position: category.position,
              questions: questions
                .filter((question) => question.category_id === category.id)
                .map((question) => ({
                  id: question.id,
                  prompt: question.prompt,
                  media: toMedia(question),
                  answers: answers
                    .filter((answer) => answer.question_id === question.id)
                    .map((answer) => ({
                      id: answer.id,
                      position: answer.position,
                      label: answer.label,
                      media: toMedia(answer),
                    })),
                })),
            })),
        })),
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
