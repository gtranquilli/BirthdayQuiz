import type { AnswerPosition } from '@/types';

export type AnswerPositionLabel = 'A' | 'B' | 'C' | 'D';

const ANSWER_POSITION_LABELS: Record<
  AnswerPosition,
  AnswerPositionLabel
> = {
  1: 'A',
  2: 'B',
  3: 'C',
  4: 'D',
};

export function isAnswerPosition(value: unknown): value is AnswerPosition {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 4
  );
}

export function getAnswerPositionLabel(
  position: number,
): AnswerPositionLabel {
  if (!isAnswerPosition(position)) {
    throw new RangeError(`Invalid answer position: ${position}`);
  }

  return ANSWER_POSITION_LABELS[position];
}
