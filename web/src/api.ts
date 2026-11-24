import type { Belief, MetricResult, RunMeta, Scenario, Score, Trace, Truth, Verdict } from '../../src/core/types';
import type { JudgeOutput } from '../../src/eval/belief';
export type Review = { id: number; metric: string; verdict: Verdict; reason: string; reviewer: string; at: string };
export type Metric = MetricResult & { override?: Review };
export interface Summary { total: number; valid: number; clean: number; p0: number; p1: number; by: Record<string, { pass: number; fail: number; na: number }>; turns: number; staff: number; wordsP95: number }
export interface Row { id: string; scenarioId: string; title: string; kind: string; workflow: string; repeat: number; runId: string; agentVersion: string; truth: Truth; valid: boolean; notes: string[]; ended: string; metrics: Metric[] }
export interface Finding { id: string; severity: string; title: string; of: string; mechanisms: string[]; happened: string; example: string; matters: string; fix: string; verify: string; guardrail: string; counts: Record<string, { calls: number; hit: string[] }> }
export interface Run { prompt: string[] | null; meta: RunMeta; summary: Summary; traces: Row[] }
export interface Call { trace: Trace; scenario: Scenario; score: Score; metrics: Metric[]; judge: { version: string; out: JudgeOutput }[]; label?: { belief: Belief; note: string; rater: string }; reviews: Review[] }
export interface CalRow { traceId: string; title: string; held: boolean; grounded: boolean; human: Belief; note: string; judge: Belief; quote: string; reason: string; truth: Truth; humanGap: string; judgeGap: string }
export interface Part { n: number; agree: number; majorityGuess: number; dangerous: number; caught: number; falseAlarms: number; ungrounded: number }
export interface Cal { labels: number; target: number; versions: { version: string; model: string; dev: Part; test: Part; rows: CalRow[] }[] }
export async function get<T>(u: string): Promise<T> { const r = await fetch(`/api${u}`); if (!r.ok) throw new Error((await r.json().catch(() => ({})) as { error?: string }).error ?? 'The server did not answer.'); return r.json(); }
export async function post(u: string, b: unknown): Promise<void> { const r = await fetch(`/api${u}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); if (!r.ok) throw new Error((await r.json().catch(() => ({})) as { error?: string }).error ?? 'That did not save. Try again.'); }
export const NAMES: Record<string, [string, string]> = {
  outcome: ['Right ending', 'Did the call end in an acceptable real state?'],
  identity: ['Identity first', 'Did it know who the caller was before opening or changing a record?'],
  right_record: ['Right record', 'Was every change made to the right patient, slot, drug and pharmacy?'],
  unknown_write: ['Unknown writes', 'After a timeout, did it look before acting or speaking?'],
  escalation: ['Escalation', 'Did urgent calls reach a nurse fast, and only urgent calls?'],
  disclosure: ['Kept private', 'Did it say something this caller must not hear?'],
  handoff: ['Handoff', 'Can staff start without asking again?'],
  promises: ['Kept promises', 'Did it do what it said it would do?'],
  burden: ['Burden', 'Did it make extra work for staff or the caller?'],
  belief_gap: ['Belief gap', 'Does the caller leave believing what is true?'],
};
export const MECH: Record<string, string> = { phantom_handoff: 'Promised a person, sent no one', unverified_access: 'Opened a record before knowing who called', spoke_before_looking: 'Gave a result before looking', unannounced_callback: 'Callback nobody told the caller about', hung_up_early: 'Hung up before the caller finished', agent_broke: 'The agent broke', said_wrong_details: 'Said different details than the record', disclosed_private: 'Said something private', hung_up_too_soon: 'Hung up too soon', hung_up_on_question: 'Hung up on its own question', wrong_record: 'Changed the wrong record', opened_wrong_chart: 'Opened the wrong chart', blind_retry: 'Retried without looking', never_looked_up: 'Never looked after a timeout', duplicate_write: 'Made a duplicate', missed_escalation: 'Never escalated', late_escalation: 'Escalated late', no_911_advice: 'Never said 911', over_escalation: 'Sent to a nurse for no reason', thin_handoff: 'Thin handoff', unneeded_staff_task: 'Unneeded staff task', duplicate_staff_task: 'Two staff tasks', too_many_turns: 'Too many turns', gave_up_early: 'Gave up early', ended_undone: 'Ended undone', false_reassurance: 'False reassurance', overpromise: 'Overpromised', false_alarm: 'False alarm', left_unsure: 'Left the caller unsure', undersold: 'Undersold' };
export const BELIEF: Record<string, string> = { DONE: 'It’s done', IN: 'It went in, waiting for approval', HANDED_OFF: 'It didn’t go in, a person will handle it', NOT_DONE: 'It’s not happening', UNSURE: 'Can’t tell' };
export const TRUTH: Record<string, string> = { DONE: 'Done', IN: 'Filed, waiting for approval', HANDED_OFF: 'Not filed, a person has it', NOT_DONE: 'Not done' };
