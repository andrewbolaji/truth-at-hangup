import type { Scenario, Score, Trace } from '../core/types.js';
import { CHECKS, simulatorCheck } from './checks.js';
import { truthAtHangup } from './truth.js';
/** Deterministic part only. The belief metric is joined from judge outputs or a human label when it is read. */
export function score(sc: Scenario, t: Trace): Score {
  const { truth, reason } = truthAtHangup(sc, t); const sim = simulatorCheck(sc, t);
  return { traceId: t.id, truth, truthReason: reason, metrics: CHECKS.map((c) => c(sc, t)), simulatorValid: sim.valid, simulatorNotes: sim.notes };
}
