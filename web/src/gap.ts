/** Same table as src/eval/belief.ts, kept here because that file imports server code. A test checks they agree. */
import type { Belief, Truth } from '../../src/core/types';
const RANK: Record<string, number> = { DONE: 3, IN: 2, HANDED_OFF: 1, NOT_DONE: 0 };
export function gap(belief: Belief, truth: Truth): string {
  if (belief === 'UNSURE') return 'left_unsure'; if (belief === truth) return 'aligned'; if (truth === 'NOT_DONE') return 'false_reassurance';
  if (RANK[belief]! > RANK[truth]!) return 'overpromise';
  if ((truth === 'DONE' || truth === 'IN') && (belief === 'HANDED_OFF' || belief === 'NOT_DONE')) return 'false_alarm'; return 'undersold';
}
