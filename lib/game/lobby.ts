import { GAME_PHASES, type GamePhase } from '@/types';

import { isAnswerPosition } from './answer-position';
import { isAvatarKey, type AvatarKey } from './avatars';

export const GAME_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
export const PLAYER_STORAGE_PREFIX = 'birthday-quiz:player:';

export interface PublicLobbyPlayer {
  readonly nickname: string;
  readonly avatarKey: AvatarKey;
}

export interface PublicGameAnswerOption {
  readonly id: string;
  readonly text: string;
  readonly position: 1 | 2 | 3 | 4;
}

export interface PublicGameQuestion {
  readonly id: string;
  readonly position: number;
  readonly category: string;
  readonly prompt: string;
  readonly options: readonly PublicGameAnswerOption[];
}

export interface PublicGameSnapshot {
  readonly code: string;
  readonly quizTitle: string;
  readonly phase: GamePhase;
  readonly participantCount: number;
  readonly maxPlayers: number;
  readonly currentQuestionIndex: number | null;
  readonly totalQuestionCount: number;
  readonly currentQuestion: PublicGameQuestion | null;
  readonly votedCount: number;
  readonly players: readonly PublicLobbyPlayer[];
}

export interface StoredPlayerEntry {
  readonly nickname: string;
  readonly avatarKey: AvatarKey;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isGamePhase(value: unknown): value is GamePhase {
  return (
    typeof value === 'string' &&
    (GAME_PHASES as readonly string[]).includes(value)
  );
}

export function normalizeGameCode(value: string): string {
  return value.trim().toUpperCase();
}

export function getPlayerStorageKey(code: string): string {
  return `${PLAYER_STORAGE_PREFIX}${normalizeGameCode(code)}`;
}

export function parseStoredPlayerEntry(value: unknown): StoredPlayerEntry | null {
  if (
    !isRecord(value) ||
    typeof value.nickname !== 'string' ||
    !isAvatarKey(value.avatarKey)
  ) {
    return null;
  }

  return { nickname: value.nickname, avatarKey: value.avatarKey };
}

function parsePublicQuestion(value: unknown): PublicGameQuestion | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.position !== 'number' ||
    !Number.isInteger(value.position) ||
    value.position < 1 ||
    typeof value.category !== 'string' ||
    typeof value.prompt !== 'string' ||
    !Array.isArray(value.options) ||
    value.options.length !== 4
  ) {
    return null;
  }

  const options: PublicGameAnswerOption[] = [];
  const positions = new Set<number>();

  for (const option of value.options) {
    if (
      !isRecord(option) ||
      typeof option.id !== 'string' ||
      typeof option.text !== 'string' ||
      !isAnswerPosition(option.position) ||
      positions.has(option.position)
    ) {
      return null;
    }

    positions.add(option.position);
    options.push({
      id: option.id,
      text: option.text,
      position: option.position,
    });
  }

  return {
    id: value.id,
    position: value.position,
    category: value.category,
    prompt: value.prompt,
    options: options.sort((left, right) => left.position - right.position),
  };
}

export function parsePublicGameSnapshot(
  value: unknown,
): PublicGameSnapshot | null {
  if (
    !isRecord(value) ||
    typeof value.code !== 'string' ||
    typeof value.quiz_title !== 'string' ||
    !isGamePhase(value.phase) ||
    typeof value.participant_count !== 'number' ||
    typeof value.max_players !== 'number' ||
    !(
      value.current_question_index === null ||
      (typeof value.current_question_index === 'number' &&
        Number.isInteger(value.current_question_index) &&
        value.current_question_index >= 0)
    ) ||
    typeof value.total_question_count !== 'number' ||
    !Number.isInteger(value.total_question_count) ||
    value.total_question_count < 0 ||
    typeof value.voted_count !== 'number' ||
    !Number.isInteger(value.voted_count) ||
    value.voted_count < 0 ||
    !Array.isArray(value.players)
  ) {
    return null;
  }

  const currentQuestion =
    value.current_question === null
      ? null
      : parsePublicQuestion(value.current_question);

  if (
    (value.current_question !== null && currentQuestion === null) ||
    (value.phase === 'lobby' &&
      (value.current_question_index !== null || currentQuestion !== null)) ||
    (value.phase === 'voting_open' &&
      (value.current_question_index === null || currentQuestion === null))
  ) {
    return null;
  }

  const players: PublicLobbyPlayer[] = [];

  for (const player of value.players) {
    if (
      !isRecord(player) ||
      typeof player.nickname !== 'string' ||
      !isAvatarKey(player.avatar_key)
    ) {
      return null;
    }

    players.push({
      nickname: player.nickname,
      avatarKey: player.avatar_key,
    });
  }

  return {
    code: value.code,
    quizTitle: value.quiz_title,
    phase: value.phase,
    participantCount: value.participant_count,
    maxPlayers: value.max_players,
    currentQuestionIndex: value.current_question_index,
    totalQuestionCount: value.total_question_count,
    currentQuestion,
    votedCount: value.voted_count,
    players,
  };
}
