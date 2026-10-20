import { parsePublicQuestion, type PublicGameQuestion } from './lobby';

export interface ExamQuestion extends PublicGameQuestion {
  readonly selectedOptionId: string | null;
  readonly correctOptionId: string | null;
}
export interface ExamProgress {
  readonly playerId: string;
  readonly lastIndex: number;
  readonly submittedAt: string | null;
  readonly completedCount: number;
  readonly result: {
    readonly total: number;
    readonly correct: number;
    readonly incorrect: number;
    readonly omitted: number;
    readonly percentage: number;
    readonly points: number;
  } | null;
  readonly questions: readonly ExamQuestion[];
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
export function parseExamProgress(value: unknown): ExamProgress | null {
  if (
    !isRecord(value) ||
    typeof value.player_id !== 'string' ||
    typeof value.last_index !== 'number' ||
    !Number.isInteger(value.last_index) ||
    typeof value.completed_count !== 'number' ||
    !(value.submitted_at === null || typeof value.submitted_at === 'string') ||
    !Array.isArray(value.questions) ||
    value.questions.length === 0
  )
    return null;
  const questions: ExamQuestion[] = [];
  for (const item of value.questions) {
    if (!isRecord(item)) return null;
    const question = parsePublicQuestion(item, false);
    if (
      !question ||
      !(
        item.selected_option_id === null ||
        question.options.some((o) => o.id === item.selected_option_id)
      ) ||
      !(value.submitted_at === null
        ? item.correct_option_id === null
        : question.options.some((o) => o.id === item.correct_option_id))
    )
      return null;
    questions.push({
      ...question,
      selectedOptionId: item.selected_option_id as string | null,
      correctOptionId: item.correct_option_id as string | null,
    });
  }
  if (
    value.last_index < 0 ||
    value.last_index >= questions.length ||
    new Set(questions.map((q) => q.id)).size !== questions.length ||
    questions.some((q, i) => q.position !== i + 1) ||
    value.completed_count !==
      questions.filter((q) => q.selectedOptionId !== null).length
  )
    return null;
  let result: ExamProgress['result'] = null;
  if (value.submitted_at !== null) {
    const r = value.result;
    if (
      !isRecord(r) ||
      ![
        'total',
        'correct',
        'incorrect',
        'omitted',
        'percentage',
        'points',
      ].every(
        (k) => typeof r[k] === 'number' && Number.isFinite(r[k]) && r[k] >= 0,
      ) ||
      r.total !== questions.length ||
      Number(r.correct) + Number(r.incorrect) + Number(r.omitted) !== r.total
    )
      return null;
    result = r as unknown as NonNullable<ExamProgress['result']>;
  } else if (value.result !== null) return null;
  return {
    playerId: value.player_id,
    lastIndex: value.last_index,
    submittedAt: value.submitted_at,
    completedCount: value.completed_count,
    result,
    questions,
  };
}
export function examError(code?: string): string {
  if (code === '42501')
    return 'Partecipazione non disponibile. Recupera la sessione e riprova.';
  if (code === 'P0001')
    return 'Esame già consegnato o non in corso. Aggiorna per recuperare lo stato.';
  if (code === '22023') return 'Domanda, risposta o posizione non valida.';
  return 'Connessione non disponibile o richiesta non riuscita. Riprova: il progresso salvato è al sicuro.';
}
