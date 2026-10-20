import { type NextRequest, NextResponse } from 'next/server';

import {
  HOST_SESSION_COOKIE_NAME,
  verifyHostSessionToken,
} from '@/lib/host/session';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

interface PresetRow {
  readonly id: string;
  readonly quiz_id: string;
  readonly name: string;
}

interface PresetRuleRow {
  readonly preset_id: string;
  readonly category_id: string;
  readonly question_count: number;
}

interface QuestionRow {
  readonly category_id: string;
}

interface SupabaseErrorDetails {
  readonly code: string;
  readonly message: string;
  readonly details: string;
  readonly hint: string;
}

function logSupabaseError(
  resource: string,
  error: SupabaseErrorDetails,
): void {
  console.error('Supabase error in GET /api/host/quizzes', {
    resource,
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  });
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
    const [
      quizzesResult,
      categoriesResult,
      presetsResult,
      rulesResult,
      questionsResult,
    ] = await Promise.all([
      admin.from('quizzes').select('id,title').order('title'),
      admin
        .from('quiz_categories')
        .select('id,quiz_id,name,position')
        .order('quiz_id')
        .order('position'),
      admin
        .from('quiz_presets')
        .select('id,quiz_id,name')
        .order('quiz_id')
        .order('name'),
      admin
        .from('preset_category_rules')
        .select('preset_id,category_id,question_count'),
      admin.from('questions').select('category_id'),
    ]);

    const queryErrors = [
      ['quizzes', quizzesResult.error],
      ['quiz_categories', categoriesResult.error],
      ['quiz_presets', presetsResult.error],
      ['preset_category_rules', rulesResult.error],
      ['questions', questionsResult.error],
    ] as const;
    let hasQueryError = false;

    for (const [resource, error] of queryErrors) {
      if (error) {
        hasQueryError = true;
        logSupabaseError(resource, error);
      }
    }

    if (hasQueryError) {
      return NextResponse.json(
        { error: 'Impossibile caricare quiz e preset.' },
        { status: 500 },
      );
    }

    const quizzes = (quizzesResult.data ?? []) as QuizRow[];
    const categories = (categoriesResult.data ?? []) as CategoryRow[];
    const presets = (presetsResult.data ?? []) as PresetRow[];
    const rules = (rulesResult.data ?? []) as PresetRuleRow[];
    const questions = (questionsResult.data ?? []) as QuestionRow[];
    const questionCountByCategory = new Map<string, number>();

    for (const question of questions) {
      questionCountByCategory.set(
        question.category_id,
        (questionCountByCategory.get(question.category_id) ?? 0) + 1,
      );
    }

    const examCounts = await Promise.all(quizzes.map(async quiz => {
      const result = await admin.rpc('get_exam_question_count', { p_quiz_id: quiz.id });
      if (result.error) throw new Error('Exam catalog unavailable');
      return [quiz.id, result.data as number] as const;
    }));
    const validCounts = new Map(examCounts);
    const payload = quizzes.map((quiz) => ({
      availableExamQuestionCount: validCounts.get(quiz.id) ?? 0,
      id: quiz.id,
      title: quiz.title,
      categories: categories
        .filter((category) => category.quiz_id === quiz.id)
        .map((category) => ({
          id: category.id,
          name: category.name,
          position: category.position,
          availableQuestionCount:
            questionCountByCategory.get(category.id) ?? 0,
        })),
      presets: presets
        .filter((preset) => preset.quiz_id === quiz.id)
        .map((preset) => ({
          id: preset.id,
          name: preset.name,
          rules: rules
            .filter((rule) => rule.preset_id === preset.id)
            .map((rule) => ({
              categoryId: rule.category_id,
              questionCount: rule.question_count,
            })),
        })),
    }));

    return NextResponse.json(
      { quizzes: payload },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      { error: 'Configurazione Supabase server non disponibile.' },
      { status: 500 },
    );
  }
}
