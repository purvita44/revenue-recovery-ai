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
  const allowedPaths: CasePath[] = ["recoverable", "customer-action", "restricted", "human-review"];
  if (!allowedActions.includes(candidate.action as RecoveryAction)) throw new Error("Invalid AI decision: unsupported action");
  if (!allowedPaths.includes(candidate.path as CasePath)) throw new Error("Invalid AI decision: unsupported path");
  if (typeof candidate.diagnosis !== "string" || !candidate.diagnosis.trim() || typeof candidate.rationale !== "string" || !candidate.rationale.trim() || typeof candidate.policyRule !== "string" || !candidate.policyRule.trim() || typeof candidate.nextStep !== "string" || !candidate.nextStep.trim() || typeof candidate.requiresApproval !== "boolean" || typeof candidate.confidence !== "number" || !Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1 || (candidate.stopReason !== undefined && typeof candidate.stopReason !== "string")) throw new Error("Invalid AI decision: missing or invalid required field");
  return candidate as Decision;
}

export function authorizeDecision(payment: Pick<PaymentCase, "failureReason" | "retryCount" | "consent" | "fraudFlag">, recommendation: Decision): Decision {
  const policy = classifyCase({ ...payment, id: "policy-check", customer: "", initials: "", amount: 0, plan: "", recoverability: 0, daysSinceFailure: 0, previousPayments: 0, outcomeSeed: 0 });
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
};

export function buildStakeholderCsv(outcomes: StakeholderOutcomeRow[], auditTrail: AuditEvent[]) {
  const headers = ["record_type", "case_id", "customer", "amount_inr", "path", "diagnosis", "action", "confidence", "policy_rule", "approval_status", "outcome", "recovered", "next_step", "stop_reason", "event_timestamp", "event_kind", "event_title", "event_detail", "event_status"];
  const rows = outcomes.map((row) => ["recovery_outcome", row.caseId, row.customer, row.amount, row.path, row.diagnosis, row.action, row.confidence, row.policyRule, row.approvalStatus, row.outcome, row.recovered, row.nextStep, row.stopReason]);
  const events = auditTrail.map((event) => ["audit_event", event.caseId, "", "", "", "", "", "", "", "", "", "", "", "", event.timestamp, event.kind, event.title, event.detail, event.status]);
  return [headers, ...rows, ...events].map((row) => row.map(escapeCsv).join(",")).join("\n") + "\n";
}
