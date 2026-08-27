# RecoverIQ Track 03 Pitch Script

## Core claim

RecoverIQ is a policy-controlled AI agent for recovering failed subscription-payment revenue. It detects synthetic revenue at risk, asks a structured AI diagnosis engine for the least aggressive effective intervention, validates that recommendation against deterministic policy, executes only a bounded simulated action, verifies the simulated outcome, and stops or escalates safely.

## AI architecture

The AI recommendation endpoint receives the case context as structured input and returns a strict JSON object containing the path, action, diagnosis, rationale, confidence, policy rule, approval requirement, next step, and stop reason. The server validates the response against a JSON schema and then runs the result through the deterministic policy validator. Invalid output, unsupported actions, missing consent, fraud flags, exhausted retry budgets, and other unsafe conditions are rejected or escalated.

This separation is intentional: the model provides contextual diagnosis and recommendation, while deterministic code remains the authority for payment safety, consent, retry limits, cooling periods, approvals, and terminal stopping rules.

## Simulator and measurement

All monetary values shown by RecoverIQ are synthetic or simulated. The application does not accept live payment credentials, call a live payment processor, or move real money. The reproducible batch contains synthetic failed-payment cases with amounts, failure reasons, retry history, consent, fraud flags, and a recoverability ground truth. The deterministic simulator returns success, temporary failure, permanent failure, or contained simulator error based on that ground truth.

The batch dashboard compares the agent with a one-retry synthetic baseline. It reports synthetic revenue at risk, simulated amount recovered, recovery rate, baseline lift, escalations, safe stops, and unrecovered value. Every decision and action produces an audit event with timestamp, diagnosis, rationale, policy rule, confidence, approval status, execution result, next step, and stop reason.

## Demo flow

Start by running the recovery batch. Show the aggregate synthetic revenue at risk and the simulated value recovered across all cases. Explain that the results are ground-truth verification from the test simulator, not live merchant revenue.

Open a transient network-failure case and click Ask AI. Show the structured recommendation, its confidence and rationale, the policy validation status, and the bounded retry timeline. Then open a missing-consent case to show that the AI cannot cause an unauthorized customer contact. Finally, open a fraud-flagged or retry-exhausted case to show human escalation and terminal stopping.

End with the dynamic comparison against the one-retry baseline and the audit trail export. The key result is not that the agent acts on every case; it is that it recovers measurable synthetic value while knowing when to retry, when to request customer action, and when to stop.
