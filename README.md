

## RecoverIQ product decisions

RecoverIQ intentionally uses a custom, unauthenticated control-room shell for the buildathon demo instead of the provided authenticated `DashboardLayout`. The provided layout is optimized for signed-in CRUD dashboards and introduces a login gate; this experience is a self-contained, reviewer-friendly simulation surface where the primary goal is to inspect recovery decisions immediately. RecoverIQ still reuses the template's accessible UI primitives, Tailwind tokens, and responsive interaction patterns.

All payment actions in this project are simulated. The recovery engine operates on a reproducible synthetic batch and a deterministic simulator; it does not accept live payment credentials, call a payment processor, or move real money. The browser-persisted audit trail is append-only by behavior: new decisions and actions are appended to the stored event sequence and no edit or delete operation is exposed.


## Track 03 evaluation notes

RecoverIQ now includes a server-side structured AI recommendation procedure. The model receives a payment case as JSON and returns a strict schema containing its diagnosis, recommended bounded action, confidence, rationale, policy rule, approval requirement, next step, and stop reason. The response is validated before the deterministic policy engine can authorize any simulated action. The model is never permitted to move money, bypass consent, override fraud restrictions, or exceed retry limits.

All monetary values in the interface are explicitly synthetic or simulated. The ground-truth simulator uses the reproducible batch's recoverability value and outcome seed to return deterministic success, temporary failure, permanent failure, or contained simulator-error outcomes. This lets the batch report measured simulated recovery value and compare the agent with a one-retry synthetic baseline without implying live merchant impact.

The baseline lift is calculated from the current batch at runtime rather than being hardcoded. Batch events are also sent to the `recoveryAuditEvents` server table through the audit API. The table is append-only at the application boundary: the app exposes insertion and ordered reading, but no edit or delete procedure.
