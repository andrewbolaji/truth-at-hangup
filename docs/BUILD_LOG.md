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
