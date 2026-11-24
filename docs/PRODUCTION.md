# Part 7: making this a production system

Priorities in order. Each one is here because of something this prototype showed.

1. **Ingest real traces with the system of record attached.** The belief gap only works if each call carries the tool log and the EHR state after the call. Capture tool calls and their raw responses at the gateway, not from the agent's own summary. A call without state gets words-only metrics and is labeled that way.
2. **Version everything a score depends on.** Agent prompt, model, tool schemas, customer policy, scenario set and evaluator prompt each get a content hash (this prototype already stores the agent prompt, scenario set and judge prompt hashes). A score without its versions can't be compared.
3. **Regression gate on scenarios, not averages.** Before release, run the scenario suite 3+ times. Block on any new P0, or any scenario that went from always-pass to sometimes-fail. Averages hide the one scenario that matters.
4. **Human review where the judge is weakest.** Sample for review: every judged dangerous gap, every judge answer whose quote isn't in the transcript, a fixed random slice for drift, and every customer's first week. Reviewers label blind, as here.
5. **Watch the judge.** Re-score a frozen labeled set on every judge or model change and weekly. Alert on drops in "dangerous gaps caught", not on overall agreement, which a lazy judge can inflate.
6. **Privacy.** Traces are PHI in production. Keep them in the customer's region, encrypt at rest, give reviewers least-privilege access, and send models only what the metric needs (the belief judge needs words, not chart data). No PHI in logs or eval fixtures. Retention per contract.
7. **Cost and speed.** Fixed checks run on every call for almost nothing. The judge runs on a sample plus every call a fixed check flags. Cache by input hash, as here.
8. **Customer-specific policy.** Escalation triggers, refill rules and acceptable endings are per customer. Store them as data next to the scenario, so one clinic's rule can't silently change another's score.
9. **Findings become owned work.** Each mechanism (blind retry, overpromise, late escalation) maps to an owner and a ticket. The ticket links the failing calls and closes only when the regression scenario passes three runs in a row.

**What I would not build yet:** a general dashboard of every metric, automatic prompt tuning against the judge, and real-time scoring during the call. Each one needs a judge we trust more than this sample can show.
