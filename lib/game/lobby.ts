import { GAME_PHASES, type GamePhase } from '@/types';

import { isAvatarKey, type AvatarKey } from './avatars';

export const GAME_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
export const PLAYER_STORAGE_PREFIX = 'birthday-quiz:player:';

export interface PublicLobbyPlayer {
  readonly nickname: string;
  readonly avatarKey: AvatarKey;
}

export interface PublicLobbySnapshot {
  readonly code: string;
  readonly quizTitle: string;
  readonly phase: GamePhase;
  readonly participantCount: number;
  readonly maxPlayers: number;
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

export function parsePublicLobbySnapshot(
  value: unknown,
): PublicLobbySnapshot | null {
  if (
    !isRecord(value) ||
    typeof value.code !== 'string' ||
    typeof value.quiz_title !== 'string' ||
    !isGamePhase(value.phase) ||
    typeof value.participant_count !== 'number' ||
    typeof value.max_players !== 'number' ||
    !Array.isArray(value.players)
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
    players,
  };
}
