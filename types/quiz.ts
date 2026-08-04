export type IsoDateString = string;
export type QuizId = string;
export type QuizCategoryId = string;
export type QuestionId = string;
export type AnswerOptionId = string;
export type QuizPresetId = string;

export type AnswerPosition = 1 | 2 | 3 | 4;

export interface AnswerOption {
  readonly id: AnswerOptionId;
  readonly questionId: QuestionId;
  readonly position: AnswerPosition;
  readonly label: string;
}

export type QuestionAnswerOptions = readonly [
  AnswerOption,
  AnswerOption,
  AnswerOption,
  AnswerOption,
];

export interface Question {
  readonly id: QuestionId;
  readonly categoryId: QuizCategoryId;
  readonly prompt: string;
  readonly points: number;
  readonly answerOptions: QuestionAnswerOptions;
}

export interface QuestionSolution {
  readonly questionId: QuestionId;
  readonly correctAnswerOptionId: AnswerOptionId;
}

export interface QuizCategory {
  readonly id: QuizCategoryId;
  readonly quizId: QuizId;
  readonly name: string;
  readonly position: number;
  readonly questions: readonly Question[];
}

export interface Quiz {
  readonly id: QuizId;
  readonly title: string;
  readonly categories: readonly QuizCategory[];
  readonly createdAt: IsoDateString;
}

export interface PresetCategoryRule {
  readonly categoryId: QuizCategoryId;
  readonly questionCount: number;
}

export interface QuizPreset {
  readonly id: QuizPresetId;
  readonly quizId: QuizId;
  readonly name: string;
  readonly categoryRules: readonly PresetCategoryRule[];
}

