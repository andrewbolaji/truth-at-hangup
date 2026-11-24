# Build log (Central time, 24 Nov 2026)

Kept while working, so the order of decisions is real.

- 2:00 Assignment arrived. 2:05 read. Chose depth on one question: does the caller hang up believing what's true?
- 2:08 Simulated EHR with faults below the agent, so a timeout can hide a write that landed.
- 2:10 Planted-failure tests first: 13 broken calls, 4 good ones. An evaluator that misses these can't score real calls.
- 2:14 Self-review before any run found four problems, all fixed:
  1. The goal text told the caller, the judge and the labeler the right ending ("Policy sends it to staff"). Added a neutral `ask`.
  2. A move made before the caller corrected themselves was scored as a wrong-record P0, even when the call ended right.
  3. Duplicate refills were only caught when a fault was planted.
  4. Opening the other Maria's chart wasn't scored. Only changing it was.
- 2:20 Pilot (sched-03, baseline, Haiku): baseline looked up after the timeout and got it right. So the baseline isn't a strawman; differences have to show up in harder cases. ~56 s and 10 model calls per call.
- 2:22 **Prediction, written before the runs finished.** `verified` adds read-back, look-before-retry, "worrying symptom means nurse" and a one-line close.
  - Better: sched-02 (late correction), sched-05 (two Marias), refill-02 (stopped strength), refill-06 (pharmacy and pickup promise), belief gap overall.
  - Same: the timeout twins. The pilot shows baseline already looks up.
  - Worse: refill-05 (old chest pain). "Any worrying symptom" should over-escalate. Also more caller turns from read-backs.
  - Unsure: refill-08 (insulin plus dizzy). Neither prompt names it.
- 2:20 Runs started (16 scenarios, 2 versions, 3 tries). While they ran, read Andrew's log of 20 hand-placed calls to Porter, Andrew's own voice agent (26 July 2026). Replay tests were green while callers heard 10 kinds of problems. Three became code here: `phantom_handoff`, `hung_up_on_question`, and an "old prompt" flag for recordings made before a prompt change. Two new scenarios: transfer fails, garbled name.
- **Prediction for the two new scenarios, before running them:** baseline announces the transfer and half the time ends without a real callback. Both versions recover the garbled name because the tool returns no match.
- 2:25 Andrew's call: no amount of simulated calling replaces a person, because Porter's worst defects only showed up on hand-placed calls. Added *Play the caller*: a person types or talks, the same checks score it, and they leave a note on what felt wrong.
