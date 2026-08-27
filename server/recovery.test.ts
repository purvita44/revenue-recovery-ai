import { describe, expect, it } from "vitest";
import { authorizeDecision, buildStakeholderCsv, calculateBaselineLift, classifyCase, generateBatch, simulateAction, validateDecision, type AuditEvent, type PaymentCase } from "../shared/recovery";

const baseCase: PaymentCase = {
  id: "PAY-TEST", customer: "Test Customer", initials: "TC", amount: 2500, plan: "Growth",
  failureReason: "network_error", retryCount: 0, consent: true, recoverability: 0.8,
  fraudFlag: false, daysSinceFailure: 1, previousPayments: 8, outcomeSeed: 0.2,
};

describe("RecoverIQ policy engine", () => {
  it("routes transient failures to a bounded retry", () => {
    const decision = classifyCase(baseCase);
    expect(decision.path).toBe("recoverable");
    expect(decision.action).toBe("retry_payment");
    expect(decision.policyRule).toContain("Transient");
  });

  it("routes customer-action failures to a reminder", () => {
    const decision = classifyCase({ ...baseCase, failureReason: "expired_card" });
    expect(decision.path).toBe("customer-action");
    expect(decision.action).toBe("send_update_reminder");
    expect(decision.requiresApproval).toBe(false);
  });

  it("blocks cases without contact consent", () => {
    const decision = classifyCase({ ...baseCase, consent: false });
    expect(decision.action).toBe("escalate_operator");
    expect(decision.stopReason).toBe("No contact consent");
    expect(decision.requiresApproval).toBe(true);
  });

  it("stops after retry-limit exhaustion", () => {
    const decision = classifyCase({ ...baseCase, retryCount: 3 });
    expect(decision.action).toBe("escalate_operator");
    expect(decision.stopReason).toContain("exhausted");
  });

  it("overrules an AI action that violates the deterministic policy", () => {
    const unsafe = { ...classifyCase(baseCase), action: "send_update_reminder" as const, path: "customer-action" as const };
    const authorized = authorizeDecision(baseCase, unsafe);
    expect(authorized.action).toBe("retry_payment");
    expect(authorized.rationale).toContain("overruled");
  });

  it("calculates baseline lift from the current batch values", () => {
    expect(calculateBaselineLift(1500, 1000)).toBe(50);
    expect(calculateBaselineLift(500, 1000)).toBe(-50);
  });

  it("routes fraud flags to restricted human review", () => {
    const decision = classifyCase({ ...baseCase, fraudFlag: true });
    expect(decision.path).toBe("restricted");
    expect(decision.action).toBe("escalate_operator");
  });

  it("contains simulator errors instead of treating them as recoveries", () => {
    const decision = classifyCase(baseCase);
    const outcome = simulateAction({ ...baseCase, outcomeSeed: 0.999 }, decision);
    expect(outcome).toBe("simulator_error");
  });

  it("generates reproducible batches for the same seed", () => {
    expect(generateBatch(7, 5)).toEqual(generateBatch(7, 5));
  });

  it("rejects malformed AI output at the policy boundary", () => {
    expect(() => validateDecision({ action: "send_money" })).toThrow("unsupported action");
    expect(() => validateDecision({ action: "retry_payment", path: "recoverable" })).toThrow("missing required field");
  });

  it("exports stakeholder outcomes and audit events as escaped CSV", () => {
    const event: AuditEvent = { id: "evt-1", caseId: "PAY-TEST", timestamp: "2026-08-27T10:00:00.000Z", kind: "diagnosis", title: "Failure, diagnosed", detail: "Customer said \"retry\"", status: "info" };
    const csv = buildStakeholderCsv([{ caseId: "PAY-TEST", customer: "Test, Customer", amount: 2500, path: "recoverable", diagnosis: "Transient failure", action: "retry_payment", confidence: 0.87, policyRule: "R-02", approvalStatus: "not_required", outcome: "success", recovered: true, nextStep: "Verify payment", stopReason: "" }], [event]);
    expect(csv).toContain("record_type,case_id,customer,amount_inr");
    expect(csv).toContain('"Test, Customer"');
    expect(csv).toContain('"Failure, diagnosed"');
    expect(csv).toContain('"Customer said ""retry"""');
    expect(csv.trimEnd().split("\n")).toHaveLength(3);
  });

  it("rejects an unsupported action at the policy boundary", () => {
    const decision = classifyCase({ ...baseCase, failureReason: "suspected_fraud", fraudFlag: true });
    expect(["retry_payment", "send_update_reminder", "escalate_operator", "stop"]).toContain(decision.action);
    expect(decision.action).not.toBe("retry_payment");
  });
});
