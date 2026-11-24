Reviewed `kyron-truth-at-hangup` at `a50733b` using source, bounded run metadata reads, and in-memory reproductions. Full replay and browser behavior remain unverified. No files changed.

### Findings, most serious first

1. **P1 · The agent can erase its own failure from the aggregate.** In `sched-07`, caller asks to cancel → agent cancels without confirming → agent hangs up before the correction. The evaluator finds a P0 wrong-record change, then excludes the call because the correction never fired. Keep agent-caused missed beats in the denominator and score missing confirmation separately. [checks.ts:125](src/eval/checks.ts:125) · [app.ts:11](src/server/app.ts:11)

2. **P1 · Correct record IDs substitute for identity verification.** In `sched-05`, caller says “Maria Garcia” → agent reads `P102`’s appointments → moves `A102` to `SL8`. No DOB or disambiguation, yet every fixed check avoids failure. Require a prior identity lookup that uniquely resolved the patient before protected reads or writes. [checks.ts:23](src/eval/checks.ts:23)

3. **P1 · Unsafe escalation and timeout handling pass.** “Hard to breathe” → “Do not call 911” → nurse transfer passes on the substring `911`. Separately, `A100` move times out → “It went through” → `list_appointments(P104)` passes unknown-write. Require affirmative emergency advice and a successful lookup of the affected record before a retry or outcome claim. [checks.ts:50](src/eval/checks.ts:50) · [checks.ts:75](src/eval/checks.ts:75)

4. **P1 · Any staff task becomes truth.** In `refill-02`, the old-strength beat → callback for unrelated `P104` → “Staff will call you” passes the fixed checks. A failed transfer followed by an unannounced callback also passes promises. Match staff actions to patient, request, and promised action. In the other direction, `sched-04` says a verified no-move is acceptable but rejects `NOT_DONE`; reconcile the fixture with its stated goal. [truth.ts:14](src/eval/truth.ts:14) · [checks.ts:113](src/eval/checks.ts:113) · [scenarios.json:146](data/scenarios/scenarios.json:146)

5. **P1 · Malformed model output can poison saved runs.** A callback with numeric `phone` is accepted by the EHR, persisted, then throws in the scorer’s `.replace()` call. Loading that file can break subsequent startups. Validate tool argument types before execution and score before publishing the trace. [conversation.ts:27](src/harness/conversation.ts:27) · [checks.ts:92](src/eval/checks.ts:92) · [store.ts:36](src/server/store.ts:36)

6. **P1 · Concurrent live calls can inherit each other’s annotations.** Two calls started for the same agent and scenario before either saves get the same repeat and trace ID. Both persist, but the later trace wins in memory and inherits labels and reviews keyed to that ID. Persist the existing session UUID as the trace ID. [live.ts:16](src/server/live.ts:16) · [conversation.ts:43](src/harness/conversation.ts:43) · [store.ts:30](src/server/store.ts:30)

7. **P1 · Replay provenance can drift.** Reusing a run ID overwrites evidence while retaining judge outputs and annotations under the same IDs. Fresh run IDs still reuse identical model requests. Historical runs are rescored against current scenarios, and “byte for byte” compares only selected fields. Reject run ID reuse, add an explicit fresh-recording mode, and pin scenario and scorer versions. Validate CLI file arguments as slugs to keep reads and writes inside their intended directories. [cli.ts:14](src/harness/cli.ts:14) · [cli.ts:34](src/harness/cli.ts:34) · [cli.ts:58](src/harness/cli.ts:58) · [store.ts:30](src/server/store.ts:30)

8. **P1 · The blinding and calibration claims exceed the evidence.** Queue IDs expose run names and unlock the full trace API. `sched-07` tells the caller simulator its future decision upfront. Judge v1 asks whether the task completed, and a fabricated quote still earns a pass when the enum matches truth. This checkout has v1 outputs and no saved human labels or reckless run. Use opaque queue IDs with separate review access, reveal corrections when due, require grounded evidence, and describe calibration as pending. [app.ts:44](src/server/app.ts:44) · [scenarios.json:290](data/scenarios/scenarios.json:290) · [belief.ts:40](src/eval/belief.ts:40) · [README.md:10](README.md:10)

9. **P2 · Comparison displays missing evidence as “Same.”** A zero denominator forces a zero delta. The run matrix also includes void calls that summary totals exclude. Show “insufficient evidence” and use the same eligible calls throughout. [compare.tsx:14](web/src/compare.tsx:14) · [runs.tsx:20](web/src/runs.tsx:20)

### Five hard follow-ups

1. **Would you ship Verified?** This evidence supports investigation. I’d first fix identity and escalation scoring, then require fresh paired runs with every attempted call accounted for.
2. **What did zero dangerous gaps establish?** Judge v1 reported zero. Its sensitivity remains unknown until humans independently label known-bad and ambiguous calls.
3. **Are three repeats independent?** Repeat salts distinguish requests within a run. Rerunning identical requests can replay the same draws.
4. **What would you change in the voice agent first?** Reconcile ambiguous writes against the exact record before retrying or telling the caller what happened. Test both timeout twins.
5. **Can you measure actual caller belief?** Transcript labels estimate what a reasonable caller would infer. Measure actual understanding with a blinded post-call question, then compare that answer with the recorded outcome.