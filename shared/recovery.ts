export type FailureReason =
  | "network_error"
  | "bank_unavailable"
  | "insufficient_funds"
  | "expired_card"
  | "invalid_payment_method"
  | "suspected_fraud"
  | "unknown_error";

export type CasePath = "recoverable" | "customer-action" | "restricted" | "human-review";
export type RecoveryAction = "retry_payment" | "send_update_reminder" | "escalate_operator" | "stop";
export type SimulationOutcome = "success" | "temporary_failure" | "permanent_failure" | "simulator_error";

export type PaymentCase = {
  id: string;
  customer: string;
  initials: string;
  amount: number;
  plan: string;
  failureReason: FailureReason;
  retryCount: number;
  consent: boolean;
  recoverability: number;
  fraudFlag: boolean;
  daysSinceFailure: number;
  previousPayments: number;
  outcomeSeed: number;
};

export type Decision = {
  path: CasePath;
  action: RecoveryAction;
  diagnosis: string;
  rationale: string;
  confidence: number;
  policyRule: string;
  requiresApproval: boolean;
  nextStep: string;
  stopReason?: string;
};

export type AuditEvent = {
  id: string;
  caseId: string;
  timestamp: string;
  kind: "diagnosis" | "action" | "verification" | "stop" | "escalation";
  title: string;
  detail: string;
  status: "success" | "warning" | "blocked" | "info";
};

const names = ["Maya Patel", "Arjun Mehta", "Sara Iyer", "Kabir Shah", "Nisha Rao", "Rohan Gupta", "Aditi Menon", "Vikram Das", "Neha Kapoor", "Dev Malhotra"];
const reasons: FailureReason[] = ["network_error", "bank_unavailable", "insufficient_funds", "expired_card", "invalid_payment_method", "suspected_fraud", "unknown_error"];
const amounts = [1299, 2499, 4999, 7999, 999, 3499, 5999];
const MIN_COOLING_DAYS = 1;

export function generateBatch(seed = 42, count = 48): PaymentCase[] {
  let state = seed >>> 0;
  const random = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return Array.from({ length: count }, (_, index) => {
    const customer = names[index % names.length];
    const failureReason = reasons[Math.floor(random() * reasons.length)];
    const fraudFlag = failureReason === "suspected_fraud" || random() < 0.035;
    const consent = random() > 0.12;
    const retryCount = Math.floor(random() * 4);
    const recoverability = Math.round((fraudFlag ? 0.08 : failureReason === "expired_card" ? 0.22 : 0.48 + random() * 0.46) * 100) / 100;
    return {
      id: `PAY-${String(1042 + index).padStart(4, "0")}`,
      customer,
      initials: customer.split(" ").map((part) => part[0]).join(""),
      amount: amounts[Math.floor(random() * amounts.length)],
      plan: ["Growth", "Scale", "Pro"][index % 3],
      failureReason,
      retryCount,
      consent,
      recoverability,
      fraudFlag,
      daysSinceFailure: 1 + Math.floor(random() * 9),
      previousPayments: 2 + Math.floor(random() * 22),
      outcomeSeed: random(),
    };
  });
}

export function classifyCase(payment: PaymentCase): Decision {
  if (payment.fraudFlag || payment.failureReason === "suspected_fraud") {
    return { path: "restricted", action: "escalate_operator", diagnosis: "Potentially restricted payment", rationale: "Fraud indicators require human review; no automated retry or customer contact is permitted.", confidence: 0.96, policyRule: "R-07 · Restricted payment", requiresApproval: true, nextStep: "Wait for operator decision", stopReason: "Automated recovery blocked by fraud policy" };
  }
  if (!payment.consent) {
    return { path: "human-review", action: "escalate_operator", diagnosis: "Customer contact unavailable", rationale: "Consent is absent, so RecoverIQ cannot send a reminder. The case is routed to an operator.", confidence: 0.98, policyRule: "R-04 · Consent gate", requiresApproval: true, nextStep: "Operator to select compliant contact route", stopReason: "No contact consent" };
  }
  if (payment.daysSinceFailure < MIN_COOLING_DAYS) {
    return { path: "human-review", action: "stop", diagnosis: "Cooling period active", rationale: "No retry or customer contact is permitted until the 24-hour cooling period has elapsed.", confidence: 1, policyRule: "R-01 · Cooling period", requiresApproval: false, nextStep: "Re-evaluate after the cooling period", stopReason: "Cooling period not elapsed" };
  }
  if (payment.retryCount >= 3) {
    return { path: "human-review", action: "escalate_operator", diagnosis: "Retry budget exhausted", rationale: "The maximum of three automatic attempts has been reached. Further retries are stopped.", confidence: 0.99, policyRule: "R-05 · Terminal retry limit", requiresApproval: true, nextStep: "Operator review required", stopReason: "Automatic retry limit exhausted" };
  }
  if (payment.failureReason === "expired_card" || payment.failureReason === "invalid_payment_method" || payment.failureReason === "insufficient_funds") {
    return { path: "customer-action", action: "send_update_reminder", diagnosis: payment.failureReason === "insufficient_funds" ? "Insufficient funds" : "Payment method needs attention", rationale: "The failure is likely recoverable after customer action, so a single payment-method update reminder is preferred over repeated retries.", confidence: 0.9, policyRule: "R-03 · Customer-action recovery", requiresApproval: false, nextStep: "Wait for payment-method update" };
  }
  return { path: "recoverable", action: "retry_payment", diagnosis: payment.failureReason === "network_error" ? "Transient network failure" : "Temporary bank degradation", rationale: "The failure pattern is transient and within retry budget. A bounded retry with backoff is permitted.", confidence: 0.87, policyRule: "R-02 · Transient retry", requiresApproval: false, nextStep: "Verify payment result after retry" };
}

export function validateDecision(input: unknown): Decision {
  if (!input || typeof input !== "object") throw new Error("Invalid AI decision: expected an object");
  const candidate = input as Partial<Decision>;
  const allowedActions: RecoveryAction[] = ["retry_payment", "send_update_reminder", "escalate_operator", "stop"];
  if (!allowedActions.includes(candidate.action as RecoveryAction)) throw new Error("Invalid AI decision: unsupported action");
  if (!candidate.path || !candidate.diagnosis || !candidate.rationale || typeof candidate.confidence !== "number" || !candidate.policyRule || typeof candidate.requiresApproval !== "boolean" || !candidate.nextStep) throw new Error("Invalid AI decision: missing required field");
  return candidate as Decision;
}

export function authorizeDecision(payment: Pick<PaymentCase, "failureReason" | "retryCount" | "consent" | "fraudFlag" | "daysSinceFailure">, recommendation: Decision): Decision {
  const policy = classifyCase({ ...payment, id: "policy-check", customer: "", initials: "", amount: 0, plan: "", recoverability: 0, previousPayments: 0, outcomeSeed: 0 });
  const samePath = policy.path === recommendation.path;
  const sameAction = policy.action === recommendation.action;
  if (samePath && sameAction) return recommendation;
  return { ...policy, rationale: `AI recommendation overruled by ${policy.policyRule}. ${policy.rationale}` };
}

export function simulateAction(payment: PaymentCase, decision: Decision): SimulationOutcome {
  if (decision.action === "escalate_operator") return "permanent_failure";
  if (decision.action === "stop") return "permanent_failure";
  if (decision.action === "send_update_reminder") return "temporary_failure";
  if (payment.outcomeSeed < payment.recoverability) return "success";
  if (payment.failureReason === "suspected_fraud") return "permanent_failure";
  if (payment.outcomeSeed > 0.97) return "simulator_error";
  return "temporary_failure";
}

export function calculateBaselineLift(recovered: number, baselineRecovered: number) {
  return Math.round(((recovered - baselineRecovered) / Math.max(1, baselineRecovered)) * 100);
}

export function baselineAction(payment: PaymentCase): RecoveryAction {
  return payment.retryCount < 1 && classifyCase(payment).path === "recoverable" ? "retry_payment" : "stop";
}

export function simulateBaseline(payment: PaymentCase): SimulationOutcome {
  const decision = classifyCase(payment);
  return simulateAction(payment, { ...decision, action: baselineAction(payment) });
}

export function formatInr(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}


export function escapeCsv(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export type StakeholderOutcomeRow = {
  caseId: string;
  customer: string;
  amount: number;
  path: string;
  diagnosis: string;
  action: string;
  confidence: number;
  policyRule: string;
  approvalStatus: string;
  outcome: string;
  recovered: boolean;
  nextStep: string;
  stopReason: string;
  finalState?: string;
  attempts?: number;
  recoveredAmount?: number;
};

export function buildStakeholderCsv(outcomes: StakeholderOutcomeRow[], auditTrail: AuditEvent[]) {
  const headers = ["record_type", "case_id", "customer", "amount_inr", "path", "diagnosis", "action", "confidence", "policy_rule", "approval_status", "outcome", "recovered", "next_step", "stop_reason", "final_state", "attempts", "recovered_amount_inr", "event_timestamp", "event_kind", "event_title", "event_detail", "event_status"];
  const rows = outcomes.map((row) => ["recovery_outcome", row.caseId, row.customer, row.amount, row.path, row.diagnosis, row.action, row.confidence, row.policyRule, row.approvalStatus, row.outcome, row.recovered, row.nextStep, row.stopReason, row.finalState || "", row.attempts ?? "", row.recoveredAmount ?? "", "", "", "", "", ""]);
  const events = auditTrail.map((event) => ["audit_event", event.caseId, "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", event.timestamp, event.kind, event.title, event.detail, event.status]);
  return [headers, ...rows, ...events].map((row) => row.map(escapeCsv).join(",")).join("\n") + "\n";
}


export type WorkflowState = "AUTOMATIC" | "WAITING" | "RECOVERED" | "STOPPED" | "ESCALATED" | "HUMAN_REVIEW";
export type WorkflowEventKind = AuditEvent["kind"] | "re_evaluation" | "state_change";

export type WorkflowEvent = AuditEvent & {
  state: WorkflowState;
  previousState?: WorkflowState;
  nextAction?: RecoveryAction;
  recoveredAmount?: number;
  policyDecision?: "allowed" | "modified" | "blocked";
  policyRule?: string;
  actionResult?: string;
};

export type RecoveryWorkflow = {
  finalState: WorkflowState;
  outcome: SimulationOutcome;
  recoveredAmount: number;
  attempts: number;
  decision: Decision;
  events: WorkflowEvent[];
};

function workflowEvent(
  payment: PaymentCase,
  id: string,
  timestamp: string,
  kind: WorkflowEventKind,
  title: string,
  detail: string,
  status: AuditEvent["status"],
  state: WorkflowState,
  extras: Partial<Omit<WorkflowEvent, "id" | "caseId" | "timestamp" | "kind" | "title" | "detail" | "status" | "state">> = {},
): WorkflowEvent {
  return { id, caseId: payment.id, timestamp, kind: kind as AuditEvent["kind"], title, detail, status, state, ...extras };
}

function simulateWorkflowRetry(payment: PaymentCase, retryNumber: number): SimulationOutcome {
  const successThreshold = Math.min(0.98, payment.recoverability + Math.max(0, retryNumber - 1) * 0.22);
  if (payment.outcomeSeed < successThreshold) return "success";
  if (payment.outcomeSeed > 0.985) return "simulator_error";
  return "temporary_failure";
}

/**
 * Runs one payment through a bounded action/observation/re-evaluation loop.
 * Existing classifyCase/simulateAction behavior remains available for callers
 * that only need a single-step result.
 */
export function runRecoveryWorkflow(payment: PaymentCase, initialDecision = classifyCase(payment), maxSteps = 5): RecoveryWorkflow {
  let currentPayment = { ...payment };
  let decision = authorizeDecision(currentPayment, initialDecision);
  let state: WorkflowState = decision.requiresApproval ? "HUMAN_REVIEW" : "AUTOMATIC";
  let attempts = currentPayment.retryCount;
  let recoveredAmount = 0;
  let outcome: SimulationOutcome = "temporary_failure";
  const events: WorkflowEvent[] = [];
  const start = Date.UTC(2026, 0, 1) + Math.round(payment.outcomeSeed * 10_000_000);
  const at = (offset: number) => new Date(start + offset * 1000).toISOString();

  events.push(workflowEvent(currentPayment, `${payment.id}-diagnosis`, at(0), "diagnosis", "Failure diagnosed", `${decision.diagnosis} · ${Math.round(decision.confidence * 100)}% model/simulation confidence`, "info", state, { nextAction: decision.action, policyDecision: "allowed", policyRule: decision.policyRule }));

  for (let step = 0; step < maxSteps; step += 1) {
    decision = authorizeDecision(currentPayment, decision);
    const policyChanged = decision.action !== initialDecision.action || decision.path !== initialDecision.path;
    events.push(workflowEvent(currentPayment, `${payment.id}-policy-${step + 1}`, at(step * 3 + 1), "re_evaluation", "Policy re-evaluated", policyChanged ? `Recommendation modified by ${decision.policyRule}.` : `Guardrails satisfied · retry ${attempts}/3 · consent ${currentPayment.consent ? "yes" : "no"} · fraud ${currentPayment.fraudFlag ? "yes" : "no"}`, policyChanged ? "warning" : "success", state, { nextAction: decision.action, policyDecision: policyChanged ? "modified" : "allowed", policyRule: decision.policyRule }));

    if (decision.requiresApproval || decision.action === "escalate_operator") {
      const nextState: WorkflowState = decision.path === "restricted" ? "HUMAN_REVIEW" : "ESCALATED";
      events.push(workflowEvent(currentPayment, `${payment.id}-escalate-${step + 1}`, at(step * 3 + 2), "escalation", "Human review required", decision.rationale, "blocked", nextState, { previousState: state, nextAction: "escalate_operator", policyDecision: "blocked", policyRule: decision.policyRule, actionResult: "No automated recovery action executed" }));
      return { finalState: nextState, outcome: "permanent_failure", recoveredAmount: 0, attempts, decision, events };
    }

    if (decision.action === "stop") {
      events.push(workflowEvent(currentPayment, `${payment.id}-stop-${step + 1}`, at(step * 3 + 2), "stop", "Workflow stopped safely", decision.stopReason || "Terminal policy condition", "warning", "STOPPED", { previousState: state, policyDecision: "blocked", policyRule: decision.policyRule, actionResult: "No further action executed" }));
      return { finalState: "STOPPED", outcome: "permanent_failure", recoveredAmount: 0, attempts, decision, events };
    }

    if (decision.action === "send_update_reminder") {
      state = "WAITING";
      events.push(workflowEvent(currentPayment, `${payment.id}-reminder-${step + 1}`, at(step * 3 + 2), "action", "Payment-update reminder sent", "Customer contact consent verified; reminder simulated without contacting a real customer.", "success", state, { previousState: "AUTOMATIC", nextAction: "retry_payment", policyDecision: "allowed", policyRule: decision.policyRule, actionResult: "reminder_sent" }));
      events.push(workflowEvent(currentPayment, `${payment.id}-method-update-${step + 1}`, at(step * 3 + 3), "verification", "Payment method updated", "Synthetic customer action completed in the simulator.", "success", "AUTOMATIC", { previousState: "WAITING", nextAction: "retry_payment", policyDecision: "allowed", policyRule: decision.policyRule, actionResult: "payment_method_updated" }));
      currentPayment = { ...currentPayment, failureReason: "network_error", daysSinceFailure: MIN_COOLING_DAYS, retryCount: 0 };
      decision = classifyCase(currentPayment);
      initialDecision = decision;
      continue;
    }

    attempts += 1;
    outcome = simulateWorkflowRetry(currentPayment, attempts);
    events.push(workflowEvent(currentPayment, `${payment.id}-retry-${attempts}`, at(step * 3 + 2), "action", `Retry #${attempts} executed`, decision.rationale, outcome === "success" ? "success" : "warning", "AUTOMATIC", { previousState: state, nextAction: outcome === "success" ? undefined : "retry_payment", policyDecision: "allowed", policyRule: decision.policyRule, actionResult: outcome === "success" ? "retry_executed_success" : "retry_executed_failure" }));

    if (outcome === "success") {
      recoveredAmount = currentPayment.amount;
      events.push(workflowEvent(currentPayment, `${payment.id}-recovered`, at(step * 3 + 3), "verification", "Payment recovered", `${formatInr(recoveredAmount)} verified against synthetic ground truth.`, "success", "RECOVERED", { previousState: "AUTOMATIC", recoveredAmount, actionResult: "payment_recovered" }));
      return { finalState: "RECOVERED", outcome, recoveredAmount, attempts, decision, events };
    }
    if (outcome === "simulator_error") {
      events.push(workflowEvent(currentPayment, `${payment.id}-simulator-error`, at(step * 3 + 3), "stop", "Simulator error contained", "The simulator failed safely; no further automated action was attempted.", "warning", "STOPPED", { previousState: "AUTOMATIC", policyDecision: "blocked", actionResult: "simulator_error" }));
      return { finalState: "STOPPED", outcome, recoveredAmount: 0, attempts, decision, events };
    }

    currentPayment = { ...currentPayment, retryCount: attempts };
    state = attempts >= 3 ? "HUMAN_REVIEW" : "AUTOMATIC";
    decision = classifyCase(currentPayment);
    initialDecision = decision;
  }

  events.push(workflowEvent(currentPayment, `${payment.id}-max-steps`, at(maxSteps * 3 + 4), "stop", "Workflow step budget exhausted", "Maximum bounded workflow steps reached; no further automated action executed.", "warning", "STOPPED", { previousState: state, policyDecision: "blocked", actionResult: "max_steps_reached" }));
  return { finalState: "STOPPED", outcome: "permanent_failure", recoveredAmount: 0, attempts, decision, events };
}
