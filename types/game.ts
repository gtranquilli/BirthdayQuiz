import type {
  AnswerOptionId,
  AnswerPosition,
  IsoDateString,
  QuestionId,
  QuizCategoryId,
  QuizId,
  QuizPresetId,
} from './quiz';

export const GAME_PHASES = [
  'lobby',
  'voting_open',
  'voting_closed',
  'answer_revealed',
  'finished',
] as const;

export type GamePhase = (typeof GAME_PHASES)[number];

export type GameSessionId = string;
export type GameQuestionId = string;
export type GameAnswerOptionId = string;
export type PlayerId = string;
export type AnonymousUserId = string;
export type VoteId = string;

export interface GameAnswerOption {
  readonly id: GameAnswerOptionId;
  readonly gameQuestionId: GameQuestionId;
  readonly sourceAnswerOptionId: AnswerOptionId | null;
  readonly position: AnswerPosition;
  readonly label: string;
}

export type GameQuestionAnswerOptions = readonly [
  GameAnswerOption,
  GameAnswerOption,
  GameAnswerOption,
  GameAnswerOption,
];

export interface GameQuestion {
  readonly id: GameQuestionId;
  readonly gameSessionId: GameSessionId;
  readonly sourceQuestionId: QuestionId | null;
  readonly position: number;
  readonly categoryName: string;
  readonly prompt: string;
  readonly points: number;
  readonly answerOptions: GameQuestionAnswerOptions;
}

export interface GameQuestionSolution {
  readonly gameQuestionId: GameQuestionId;
  readonly correctGameAnswerOptionId: GameAnswerOptionId;
}

export interface GameSessionCategoryConfig {
  readonly sourceCategoryId: QuizCategoryId | null;
  readonly position: number;
  readonly categoryName: string;
  readonly questionCount: number;
}

export interface RevealedPlayerAvatar {
  readonly playerId: PlayerId;
  readonly avatarKey: string;
}

export interface AnswerReveal {
  readonly gameAnswerOptionId: GameAnswerOptionId;
  readonly playerAvatars: readonly RevealedPlayerAvatar[];
}

export interface GameQuestionReveal {
  readonly gameQuestionId: GameQuestionId;
  readonly correctGameAnswerOptionId: GameAnswerOptionId;
  readonly answers: readonly AnswerReveal[];
}

interface GameSessionBase {
  readonly id: GameSessionId;
  readonly code: string;
  readonly sourceQuizId: QuizId | null;
  readonly quizTitle: string;
  readonly sourcePresetId: QuizPresetId | null;
  readonly presetName: string;
  readonly categoryConfig: readonly GameSessionCategoryConfig[];
  readonly maxPlayers: number;
  readonly questions: readonly GameQuestion[];
  readonly questionOrder: readonly GameQuestionId[];
  readonly participantCount: number;
  readonly votedCount: number;
  readonly createdAt: IsoDateString;
  readonly startedAt: IsoDateString | null;
  readonly finishedAt: IsoDateString | null;
  readonly updatedAt: IsoDateString;
}

export interface LobbyGameSession extends GameSessionBase {
  readonly phase: 'lobby';
  readonly currentQuestionId: null;
  readonly reveal: null;
}

export interface VotingGameSession extends GameSessionBase {
  readonly phase: 'voting_open' | 'voting_closed';
  readonly currentQuestionId: GameQuestionId;
  readonly reveal: null;
}

export interface RevealedGameSession extends GameSessionBase {
  readonly phase: 'answer_revealed';
  readonly currentQuestionId: GameQuestionId;
  readonly reveal: GameQuestionReveal;
}

export interface FinishedGameSession extends GameSessionBase {
  readonly phase: 'finished';
  readonly currentQuestionId: GameQuestionId | null;
  readonly reveal: null;
}

export type GameSession =
  | LobbyGameSession
  | VotingGameSession
  | RevealedGameSession
  | FinishedGameSession;

export interface Player {
  readonly id: PlayerId;
  readonly gameSessionId: GameSessionId;
  readonly anonymousUserId: AnonymousUserId;
  readonly nickname: string;
  readonly avatarKey: string;
  readonly totalScore: number;
  readonly joinedAt: IsoDateString;
}

export interface Vote {
  readonly id: VoteId;
  readonly gameSessionId: GameSessionId;
  readonly gameQuestionId: GameQuestionId;
  readonly playerId: PlayerId;
  readonly gameAnswerOptionId: GameAnswerOptionId;
  readonly submittedAt: IsoDateString;
  readonly isCorrect: boolean | null;
  readonly pointsAwarded: number | null;
}

export interface Score {
  readonly playerId: PlayerId;
  readonly totalPoints: number;
  readonly rank: number;
}
