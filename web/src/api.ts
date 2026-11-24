import type { Belief, MetricResult, RunMeta, Scenario, Score, Trace, Truth, Verdict } from '../../src/core/types';
import type { JudgeOutput } from '../../src/eval/belief';
export type Review = { id: number; metric: string; verdict: Verdict; reason: string; reviewer: string; at: string };
export type Metric = MetricResult & { override?: Review };
export interface Summary { total: number; valid: number; clean: number; p0: number; p1: number; by: Record<string, { pass: number; fail: number; na: number }>; turns: number; staff: number }
export interface Row { id: string; scenarioId: string; title: string; kind: string; workflow: string; repeat: number; runId: string; agentVersion: string; truth: Truth; valid: boolean; notes: string[]; ended: string; metrics: Metric[] }
export interface Run { meta: RunMeta; summary: Summary; traces: Row[] }
export interface Call { trace: Trace; scenario: Scenario; score: Score; metrics: Metric[]; judge: { version: string; out: JudgeOutput }[]; label?: { belief: Belief; note: string; rater: string }; reviews: Review[] }
export interface CalRow { traceId: string; title: string; human: Belief; note: string; judge: Belief; quote: string; reason: string; truth: Truth; humanGap: string; judgeGap: string }
export interface Cal { labels: number; target: number; versions: { version: string; model: string; n: number; agree: number; majorityGuess: number; caught: number; dangerous: number; falseAlarms: number; rows: CalRow[] }[] }
export async function get<T>(u: string): Promise<T> { const r = await fetch(`/api${u}`); if (!r.ok) throw new Error((await r.json().catch(() => ({})) as { error?: string }).error ?? 'The server did not answer.'); return r.json(); }
export async function post(u: string, b: unknown): Promise<void> { const r = await fetch(`/api${u}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); if (!r.ok) throw new Error((await r.json().catch(() => ({})) as { error?: string }).error ?? 'That did not save. Try again.'); }
export const NAMES: Record<string, [string, string]> = {
  outcome: ['Right ending', 'Did the call end in an acceptable real state?'],
  right_record: ['Right record', 'Was every change made to the right patient, slot, drug and pharmacy?'],
  unknown_write: ['Unknown writes', 'After a timeout, did it look before acting or speaking?'],
  escalation: ['Escalation', 'Did urgent calls reach a nurse fast, and only urgent calls?'],
  handoff: ['Handoff', 'Can staff start without asking again?'],
  promises: ['Kept promises', 'Did it do what it said it would do?'],
  burden: ['Burden', 'Did it make extra work for staff or the caller?'],
  belief_gap: ['Belief gap', 'Does the caller leave believing what is true?'],
};
export const MECH: Record<string, string> = { phantom_handoff: 'Promised a person, sent no one', hung_up_on_question: 'Hung up on its own question', wrong_record: 'Changed the wrong record', opened_wrong_chart: 'Opened the wrong chart', blind_retry: 'Retried without looking', never_looked_up: 'Never looked after a timeout', duplicate_write: 'Made a duplicate', missed_escalation: 'Never escalated', late_escalation: 'Escalated late', no_911_advice: 'Never said 911', over_escalation: 'Sent to a nurse for no reason', thin_handoff: 'Thin handoff', unneeded_staff_task: 'Unneeded staff task', duplicate_staff_task: 'Two staff tasks', too_many_turns: 'Too many turns', gave_up_early: 'Gave up early', ended_undone: 'Ended undone', false_reassurance: 'False reassurance', overpromise: 'Overpromised', false_alarm: 'False alarm', left_unsure: 'Left the caller unsure', undersold: 'Undersold' };
export const BELIEF: Record<string, string> = { DONE: 'It is done', PENDING: 'Someone will finish it', NOT_DONE: 'It did not happen', UNSURE: 'Can not tell' };
