import { GAME_PHASES, type GamePhase } from '@/types';

import { isAnswerPosition } from './answer-position';
import { isAvatarKey, type AvatarKey } from './avatars';

export const GAME_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
export const PLAYER_STORAGE_PREFIX = 'birthday-quiz:player:';

export interface PublicLobbyPlayer {
  readonly nickname: string;
  readonly avatarKey: AvatarKey;
}

export interface PublicLeaderboardPlayer extends PublicLobbyPlayer {
  readonly rank: number;
  readonly score: number;
  readonly currentPoints: number;
}

export interface PublicGameAnswerOption {
  readonly id: string;
  readonly text: string;
  readonly position: 1 | 2 | 3 | 4;
}

export interface PublicRevealedGameAnswerOption
  extends PublicGameAnswerOption {
  readonly isCorrect: boolean;
  readonly players: readonly PublicLobbyPlayer[];
  readonly voteCount: number;
}

export interface PublicGameQuestion {
  readonly id: string;
  readonly position: number;
  readonly category: string;
  readonly prompt: string;
  readonly options: readonly PublicGameAnswerOption[];
}

export interface PublicRevealedGameQuestion
  extends Omit<PublicGameQuestion, 'options'> {
  readonly options: readonly PublicRevealedGameAnswerOption[];
}

interface PublicGameSnapshotBase {
  readonly code: string;
  readonly quizTitle: string;
  readonly participantCount: number;
  readonly maxPlayers: number;
  readonly totalQuestionCount: number;
  readonly votedCount: number;
  readonly players: readonly PublicLobbyPlayer[];
  readonly leaderboard: readonly PublicLeaderboardPlayer[];
}

export interface PublicLobbyGameSnapshot extends PublicGameSnapshotBase {
  readonly phase: 'lobby';
  readonly currentQuestionIndex: null;
  readonly currentQuestion: null;
  readonly correctOptionId: null;
  readonly nonVoters: readonly PublicLobbyPlayer[];
}

export interface PublicVotingGameSnapshot extends PublicGameSnapshotBase {
  readonly phase: 'voting_open' | 'voting_closed';
  readonly currentQuestionIndex: number;
  readonly currentQuestion: PublicGameQuestion;
  readonly correctOptionId: null;
  readonly nonVoters: readonly PublicLobbyPlayer[];
}

export interface PublicAnswerRevealedGameSnapshot
  extends PublicGameSnapshotBase {
  readonly phase: 'answer_revealed';
  readonly currentQuestionIndex: number;
  readonly currentQuestion: PublicRevealedGameQuestion;
  readonly correctOptionId: string;
  readonly nonVoters: readonly PublicLobbyPlayer[];
}

export interface PublicFinishedGameSnapshot extends PublicGameSnapshotBase {
  readonly phase: 'finished';
  readonly currentQuestionIndex: number;
  readonly currentQuestion: null;
  readonly correctOptionId: null;
  readonly nonVoters: readonly PublicLobbyPlayer[];
}

export type PublicGameSnapshot =
  | PublicLobbyGameSnapshot
  | PublicVotingGameSnapshot
  | PublicAnswerRevealedGameSnapshot
  | PublicFinishedGameSnapshot;

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

function getPublicPlayerKey(player: PublicLobbyPlayer): string {
  return `${player.avatarKey}:${player.nickname}`;
}

function parsePublicPlayers(value: unknown): PublicLobbyPlayer[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const players: PublicLobbyPlayer[] = [];
  const nicknames = new Set<string>();
  const avatarKeys = new Set<AvatarKey>();

  for (const player of value) {
    if (
      !isRecord(player) ||
      typeof player.nickname !== 'string' ||
      !isAvatarKey(player.avatar_key)
    ) {
      return null;
    }

    const parsedPlayer = {
      nickname: player.nickname,
      avatarKey: player.avatar_key,
    };
    const normalizedNickname = parsedPlayer.nickname.trim().toLowerCase();

    if (
      normalizedNickname.length === 0 ||
      nicknames.has(normalizedNickname) ||
      avatarKeys.has(parsedPlayer.avatarKey)
    ) {
      return null;
    }

    nicknames.add(normalizedNickname);
    avatarKeys.add(parsedPlayer.avatarKey);
    players.push(parsedPlayer);
  }

  return players;
}

function parsePublicLeaderboard(
  value: unknown,
  players: readonly PublicLobbyPlayer[],
): PublicLeaderboardPlayer[] | null {
  if (!Array.isArray(value) || value.length !== players.length) {
    return null;
  }

  const knownPlayers = new Set(players.map(getPublicPlayerKey));
  const leaderboardPlayers = new Set<string>();
  const leaderboard: PublicLeaderboardPlayer[] = [];
  let previousScore: number | null = null;
  let previousRank = 0;

  for (const [index, entry] of value.entries()) {
    if (
      !isRecord(entry) ||
      typeof entry.nickname !== 'string' ||
      !isAvatarKey(entry.avatar_key) ||
      typeof entry.rank !== 'number' ||
      !Number.isInteger(entry.rank) ||
      entry.rank < 1 ||
      typeof entry.score !== 'number' ||
      !Number.isInteger(entry.score) ||
      entry.score < 0 ||
      typeof entry.current_points !== 'number' ||
      !Number.isInteger(entry.current_points) ||
      entry.current_points < 0 ||
      entry.current_points > entry.score
    ) {
      return null;
    }

    const playerKey = getPublicPlayerKey({
      nickname: entry.nickname,
      avatarKey: entry.avatar_key,
    });
    const expectedRank =
      previousScore === entry.score ? previousRank : index + 1;

    if (
      !knownPlayers.has(playerKey) ||
      leaderboardPlayers.has(playerKey) ||
      entry.rank !== expectedRank ||
      (previousScore !== null && entry.score > previousScore)
    ) {
      return null;
    }

    leaderboardPlayers.add(playerKey);
    previousScore = entry.score;
    previousRank = entry.rank;
    leaderboard.push({
      nickname: entry.nickname,
      avatarKey: entry.avatar_key,
      rank: entry.rank,
      score: entry.score,
      currentPoints: entry.current_points,
    });
  }

  return leaderboard;
}

function parsePublicQuestion(
  value: unknown,
  revealed: false,
): PublicGameQuestion | null;
function parsePublicQuestion(
  value: unknown,
  revealed: true,
): PublicRevealedGameQuestion | null;
function parsePublicQuestion(
  value: unknown,
  revealed: boolean,
): PublicGameQuestion | PublicRevealedGameQuestion | null {
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
  const revealedOptions: PublicRevealedGameAnswerOption[] = [];
  const optionIds = new Set<string>();
  const positions = new Set<number>();

  for (const option of value.options) {
    if (
      !isRecord(option) ||
      typeof option.id !== 'string' ||
      typeof option.text !== 'string' ||
      !isAnswerPosition(option.position) ||
      optionIds.has(option.id) ||
      positions.has(option.position)
    ) {
      return null;
    }

    optionIds.add(option.id);
    positions.add(option.position);
    const baseOption: PublicGameAnswerOption = {
      id: option.id,
      text: option.text,
      position: option.position,
    };

    if (!revealed) {
      if (
        'is_correct' in option ||
        'players' in option ||
        'vote_count' in option
      ) {
        return null;
      }

      options.push(baseOption);
      continue;
    }

    const optionPlayers = parsePublicPlayers(option.players);

    if (
      typeof option.is_correct !== 'boolean' ||
      typeof option.vote_count !== 'number' ||
      !Number.isInteger(option.vote_count) ||
      option.vote_count < 0 ||
      optionPlayers === null ||
      option.vote_count !== optionPlayers.length
    ) {
      return null;
    }

    revealedOptions.push({
      ...baseOption,
      isCorrect: option.is_correct,
      players: optionPlayers,
      voteCount: option.vote_count,
    });
  }

  const questionBase = {
    id: value.id,
    position: value.position,
    category: value.category,
    prompt: value.prompt,
  };

  if (revealed) {
    return {
      ...questionBase,
      options: revealedOptions.sort(
        (left, right) => left.position - right.position,
      ),
    };
  }

  return {
    ...questionBase,
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
    value.voted_count > value.participant_count ||
    !(
      value.correct_option_id === null ||
      typeof value.correct_option_id === 'string'
    )
  ) {
    return null;
  }

  const players = parsePublicPlayers(value.players);

  if (players === null || players.length !== value.participant_count) {
    return null;
  }

  const leaderboard = parsePublicLeaderboard(value.leaderboard, players);

  if (
    leaderboard === null ||
    (value.phase !== 'answer_revealed' &&
      leaderboard.some((player) => player.currentPoints !== 0))
  ) {
    return null;
  }

  const commonSnapshot = {
    code: value.code,
    quizTitle: value.quiz_title,
    participantCount: value.participant_count,
    maxPlayers: value.max_players,
    totalQuestionCount: value.total_question_count,
    votedCount: value.voted_count,
    players,
    leaderboard,
  };

  if (value.phase === 'lobby') {
    if (
      value.current_question_index !== null ||
      value.current_question !== null ||
      value.correct_option_id !== null ||
      !Array.isArray(value.non_voters) ||
      value.non_voters.length !== 0
    ) {
      return null;
    }

    return {
      ...commonSnapshot,
      phase: 'lobby',
      currentQuestionIndex: null,
      currentQuestion: null,
      correctOptionId: null,
      nonVoters: [],
    };
  }

  if (value.phase === 'voting_open' || value.phase === 'voting_closed') {
    const currentQuestion = parsePublicQuestion(value.current_question, false);

    if (
      value.current_question_index === null ||
      value.total_question_count < 1 ||
      value.current_question_index >= value.total_question_count ||
      currentQuestion === null ||
      currentQuestion.position !== value.current_question_index + 1 ||
      value.correct_option_id !== null ||
      !Array.isArray(value.non_voters) ||
      value.non_voters.length !== 0
    ) {
      return null;
    }

    return {
      ...commonSnapshot,
      phase: value.phase,
      currentQuestionIndex: value.current_question_index,
      currentQuestion,
      correctOptionId: null,
      nonVoters: [],
    };
  }

  if (value.phase === 'answer_revealed') {
    const currentQuestion = parsePublicQuestion(value.current_question, true);
    const nonVoters = parsePublicPlayers(value.non_voters);

    if (
      value.current_question_index === null ||
      value.total_question_count < 1 ||
      value.current_question_index >= value.total_question_count ||
      currentQuestion === null ||
      currentQuestion.position !== value.current_question_index + 1 ||
      typeof value.correct_option_id !== 'string' ||
      nonVoters === null
    ) {
      return null;
    }

    const correctOptions = currentQuestion.options.filter(
      (option) => option.isCorrect,
    );

    if (
      correctOptions.length !== 1 ||
      correctOptions[0]?.id !== value.correct_option_id
    ) {
      return null;
    }

    const knownPlayerKeys = new Set(players.map(getPublicPlayerKey));
    const assignedPlayerKeys = new Set<string>();
    let distributedVoteCount = 0;

    for (const option of currentQuestion.options) {
      distributedVoteCount += option.voteCount;

      for (const optionPlayer of option.players) {
        const playerKey = getPublicPlayerKey(optionPlayer);

        if (
          !knownPlayerKeys.has(playerKey) ||
          assignedPlayerKeys.has(playerKey)
        ) {
          return null;
        }

        assignedPlayerKeys.add(playerKey);
      }
    }

    for (const nonVoter of nonVoters) {
      const playerKey = getPublicPlayerKey(nonVoter);

      if (!knownPlayerKeys.has(playerKey) || assignedPlayerKeys.has(playerKey)) {
        return null;
      }

      assignedPlayerKeys.add(playerKey);
    }

    if (
      distributedVoteCount !== value.voted_count ||
      assignedPlayerKeys.size !== players.length
    ) {
      return null;
    }

    return {
      ...commonSnapshot,
      phase: 'answer_revealed',
      currentQuestionIndex: value.current_question_index,
      currentQuestion,
      correctOptionId: value.correct_option_id,
      nonVoters,
    };
  }

  if (
    value.phase !== 'finished' ||
    value.total_question_count < 1 ||
    value.current_question_index === null ||
    value.current_question_index !== value.total_question_count - 1 ||
    value.current_question !== null ||
    value.voted_count !== 0 ||
    value.correct_option_id !== null ||
    !Array.isArray(value.non_voters) ||
    value.non_voters.length !== 0
  ) {
    return null;
  }

  return {
    ...commonSnapshot,
    phase: 'finished',
    currentQuestionIndex: value.current_question_index,
    currentQuestion: null,
    correctOptionId: null,
    nonVoters: [],
  };
}
