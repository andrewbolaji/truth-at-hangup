/** Shared vocabulary. Scenario, trace and score shapes are the contract between harness, evaluators, API and UI. */
import { z } from 'zod';

/** IN: the request is in the system, waiting for approval. HANDED_OFF: it isn't, and a person has the job. Merging these two hid the worst failure we found. */
export const Truth = z.enum(['DONE', 'IN', 'HANDED_OFF', 'NOT_DONE']);
export type Truth = z.infer<typeof Truth>;
/** What a reasonable caller would believe at hang-up, from the words alone. */
export const Belief = z.enum(['DONE', 'IN', 'HANDED_OFF', 'NOT_DONE', 'UNSURE']);
export type Belief = z.infer<typeof Belief>;

const Fault = z.object({
  tool: z.string(),
  /** Which call to this tool (1-based) the fault hits. 0 means every call. */
  nth: z.number().int().min(0),
  effect: z.enum(['commit_then_timeout', 'timeout_no_commit', 'error']),
});
export type Fault = z.infer<typeof Fault>;

const Beat = z.object({
  /** Caller turn (1 = first reply after the opening line). */
  turn: z.number().int().min(1),
  /** Wait until the agent has said something matching this before firing. Keeps corrections in context. */
  after: z.string().optional(),
  instruction: z.string(),
  /** The caller line must match this, or the scripted fallback is spoken instead. */
  mustMatch: z.string(),
  fallback: z.string(),
});
export type Beat = z.infer<typeof Beat>;

export const Scenario = z.object({
  id: z.string(),
  workflow: z.enum(['scheduling', 'refill']),
  kind: z.enum(['ordinary', 'hard', 'control']),
  title: z.string(),
  /** The right ending. Evaluators and reviewers only. */
  goal: z.string(),
  /** What the caller says they want. The caller, the judge and the labeler see this, so none of them is handed the answer. */
  ask: z.string(),
  opening: z.string(),
  callerFacts: z.array(z.string()),
  callerStyle: z.string(),
  beats: z.array(Beat).default([]),
  faults: z.array(Fault).default([]),
  policy: z.array(z.string()),
  /** What the evaluator can not know, on purpose. */
  unavailable: z.string(),
  why: z.string(),
  expect: z.object({
    /** Final state that counts as the request being done. null means it must not be completed by the agent. */
    target: z.union([
      z.object({ type: z.literal('appointment'), patientId: z.string(), appointmentId: z.string(), slotId: z.string() }),
      z.object({ type: z.literal('refill'), patientId: z.string(), medicationId: z.string(), pharmacyId: z.string() }),
      z.null(),
    ]),
    acceptableTruth: z.array(Truth).min(1),
    /** Writes to these patients or records are always wrong. */
    forbidden: z.array(z.string()).default([]),
    escalation: z.object({
      required: z.boolean(),
      /** The caller words that make it urgent. Used to time the escalation. */
      trigger: z.string().optional(),
      target: z.enum(['nurse_line', 'front_desk']).optional(),
      must_say: z.string().optional(),
      /** A nurse is reasonable though nothing is urgent, such as a dose the record and the bottle disagree on. */
      nurseOk: z.boolean().optional(),
    }),
    /** A staff task (transfer or callback) is the right answer here, so it is not counted as burden. */
    staffTaskOk: z.boolean(),
    /** Words the agent must never say on this call: another person's details, or its own instructions. */
    mustNotSay: z.array(z.string()).optional(),
  }),
});
export type Scenario = z.infer<typeof Scenario>;

export interface Appointment { id: string; patientId: string; slotId: string; provider: string; when: string; status: 'booked' | 'cancelled' }
export interface Slot { id: string; provider: string; when: string; open: boolean }
export interface Medication { id: string; patientId: string; name: string; strength: string; status: 'active' | 'discontinued'; controlled: boolean }
export interface Pharmacy { id: string; name: string }
export interface Refill { id: string; patientId: string; medicationId: string; pharmacyId: string; status: 'pending_clinician' }
export interface StaffTask { id: string; type: 'transfer' | 'callback'; target: string; patientId: string | null; reason: string; tried: string; phone: string | null; urgency: string }
export interface World {
  patients: { id: string; name: string; dob: string; phone: string }[];
  appointments: Appointment[]; slots: Slot[]; medications: Medication[]; pharmacies: Pharmacy[]; refills: Refill[]; staffTasks: StaffTask[];
}

export type TraceEvent =
  | { seq: number; kind: 'caller'; text: string; source: 'scripted' | 'generated' | 'fallback' | 'human'; beat?: number }
  | { seq: number; kind: 'agent'; text: string }
  | { seq: number; kind: 'tool'; name: string; args: Record<string, unknown>; result: unknown; ok: boolean; fault?: Fault['effect']; diff: string[] }
  | { seq: number; kind: 'system'; text: string };

export interface Trace {
  id: string; runId: string; scenarioId: string; repeat: number; agentVersion: string;
  model: string; events: TraceEvent[]; initial: World; final: World;
  ended: 'agent' | 'caller' | 'transfer' | 'turn_limit' | 'error'; startedAt: string; durationMs: number;
  /** Set when a person played the caller. */
  human?: { tester: string; note: string; voice: boolean };
}

export type Verdict = 'pass' | 'fail' | 'na';
export interface MetricResult { metric: string; version: string; verdict: Verdict; severity: 'P0' | 'P1' | 'P2' | null; summary: string; evidence: number[]; mechanism: string | null; detail?: Record<string, unknown> }
export interface Score { traceId: string; truth: Truth; truthReason: string; metrics: MetricResult[]; simulatorValid: boolean; simulatorNotes: string[] }
export interface RunMeta { id: string; agentVersion: string; agentPromptSha: string; model: string; repeats: number; createdAt: string; note: string; scenarioSetSha: string; callerVersion: string; callerPromptSha: string; fresh?: string; /** Safety rules enforced by the tools and call controller. */ guards?: boolean }
