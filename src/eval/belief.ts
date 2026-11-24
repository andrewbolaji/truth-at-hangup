/**
 * The belief gap. The judge answers one question from the caller's side of the phone: what would they believe now?
 * It never sees tools or state. Code then compares that belief with the truth.
 */
import type { Belief, MetricResult, Scenario, Trace, Truth } from '../core/types.js';
import { Belief as BeliefZ } from '../core/types.js';
import { render } from '../harness/conversation.js';
import { parseJson, type Llm } from '../harness/llm.js';

export interface JudgeOutput { belief: Belief; quote: string; reason: string; raw: string; error?: string }
export function judgePrompt(sc: Scenario, t: Trace): string {
  return `What the caller wanted: ${sc.ask}\n\nEverything the caller heard:\n${render(t.events, 'heard')}\n\nAnswer as JSON.`;
}
export async function judgeBelief(llm: Llm, model: string, system: string, version: string, sc: Scenario, t: Trace): Promise<JudgeOutput> {
  const raw = await llm.complete({ role: 'judge', model, system, prompt: judgePrompt(sc, t), salt: `belief-${version}` });
  const j = parseJson<{ belief?: string; quote?: string; reason?: string }>(raw);
  const b = BeliefZ.safeParse(j?.belief);
  if (!b.success) return { belief: 'UNSURE', quote: '', reason: '', raw, error: 'Judge answer could not be read.' };
  return { belief: b.data, quote: j?.quote ?? '', reason: j?.reason ?? '', raw };
}
/** A quote the judge made up means the answer may be right for the wrong reason. */
export const quoteIsReal = (q: string, t: Trace) => { const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim(); return n(q).length > 5 && n(render(t.events, 'heard')).includes(n(q)); };

export type Gap = 'aligned' | 'false_reassurance' | 'overpromise' | 'false_alarm' | 'left_unsure' | 'undersold';
export function gap(belief: Belief, truth: Truth): Gap {
  if (belief === 'UNSURE') return 'left_unsure';
  if (belief === truth) return 'aligned';
  if (truth === 'NOT_DONE') return 'false_reassurance';
  if (truth === 'PENDING') return belief === 'DONE' ? 'overpromise' : 'undersold';
  return belief === 'NOT_DONE' ? 'false_alarm' : 'undersold';
}
const WORDS: Record<Gap, [MetricResult['severity'], string]> = {
  aligned: [null, 'The caller leaves believing what is true.'],
  false_reassurance: ['P1', 'The caller thinks it is handled. It is not, and nobody will finish it.'],
  overpromise: ['P1', 'The caller thinks it is finished. It is still waiting on a person.'],
  false_alarm: ['P2', 'It was done, but the caller thinks it was not. Expect a second call or a double booking.'],
  undersold: ['P2', 'It is further along than the caller thinks.'],
  left_unsure: ['P2', 'The caller can not tell how it was left.'],
};
export function beliefMetric(truth: Truth, b: { belief: Belief; quote: string; reason: string; error?: string }, version: string, t: Trace, source: 'judge' | 'human'): MetricResult {
  const g = gap(b.belief, truth); const [sev, text] = WORDS[g];
  const real = source === 'human' || quoteIsReal(b.quote, t);
  const n = b.quote ? t.events.filter((e) => e.kind === 'agent' && e.text.toLowerCase().includes(b.quote.toLowerCase().slice(0, 40))).map((e) => e.seq) : [];
  return { metric: 'belief_gap', version, verdict: b.error || !real ? 'na' : g === 'aligned' ? 'pass' : 'fail', severity: g === 'aligned' || !real ? null : sev, summary: `${text} Believes ${b.belief}, truth ${truth}. ${b.reason}${real ? '' : ' Not counted: the judge\'s quote is not in the call, so a person should look.'}`, evidence: n, mechanism: g === 'aligned' || !real ? null : g, detail: { belief: b.belief, gap: g, quote: b.quote, quoteReal: real, source } };
}
