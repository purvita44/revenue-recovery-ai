import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { appendRecoveryAuditEvents, listRecoveryAuditEvents } from "./db";
import { invokeLLM } from "./_core/llm";
import { authorizeDecision, validateDecision } from "../shared/recovery";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  audit: router({
    list: publicProcedure.query(() => listRecoveryAuditEvents()),
    append: publicProcedure.input(z.array(z.object({
      eventId: z.string().max(80), caseId: z.string().max(32), kind: z.string().max(32), title: z.string().max(160), detail: z.string(), status: z.string().max(24), eventTimestamp: z.coerce.date(),
    }))).mutation(({ input }) => appendRecoveryAuditEvents(input)),
  }),
  ai: router({
    recommend: publicProcedure.input(z.object({ caseId: z.string(), customer: z.string(), amount: z.number(), failureReason: z.enum(["network_error", "bank_unavailable", "insufficient_funds", "expired_card", "invalid_payment_method", "suspected_fraud", "unknown_error"]), retryCount: z.number(), consent: z.boolean(), fraudFlag: z.boolean() })).mutation(async ({ input }) => {
      const response = await invokeLLM({
        messages: [
          { role: "system", content: "You are RecoverIQ's payment-recovery diagnosis engine. Recommend only a bounded simulated action. Never move money. Respect consent, fraud, and retry limits. Return only the requested structured object." },
          { role: "user", content: JSON.stringify(input) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "recovery_recommendation", strict: true, schema: {
            type: "object", additionalProperties: false,
            properties: {
              path: { type: "string", enum: ["recoverable", "customer-action", "restricted", "human-review"] },
              action: { type: "string", enum: ["retry_payment", "send_update_reminder", "escalate_operator", "stop"] },
              diagnosis: { type: "string" }, rationale: { type: "string" }, confidence: { type: "number" }, policyRule: { type: "string" }, requiresApproval: { type: "boolean" }, nextStep: { type: "string" }, stopReason: { type: "string" },
            }, required: ["path", "action", "diagnosis", "rationale", "confidence", "policyRule", "requiresApproval", "nextStep", "stopReason"],
          } },
        },
      });
      const content = response.choices?.[0]?.message?.content;
      try {
        const recommendation = validateDecision(JSON.parse(typeof content === "string" ? content : JSON.stringify(content)));
        return authorizeDecision(input, recommendation);
      }
      catch (error) { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error instanceof Error ? error.message : "Invalid AI recommendation" }); }
    }),
    recommendBatch: publicProcedure.input(z.object({ cases: z.array(z.object({ caseId: z.string(), customer: z.string(), amount: z.number(), failureReason: z.enum(["network_error", "bank_unavailable", "insufficient_funds", "expired_card", "invalid_payment_method", "suspected_fraud", "unknown_error"]), retryCount: z.number(), consent: z.boolean(), fraudFlag: z.boolean() })).max(60) })).mutation(async ({ input }) => {
      const response = await invokeLLM({
        messages: [
          { role: "system", content: "You are RecoverIQ's batch payment-recovery diagnosis engine. For every case, recommend only one bounded simulated action. Never move money. Respect consent, fraud, and retry limits. Return one decision per case in the same order. Return only the requested structured JSON array." },
          { role: "user", content: JSON.stringify(input.cases) },
        ],
        response_format: { type: "json_schema", json_schema: { name: "recovery_batch_recommendations", strict: true, schema: { type: "array", items: { type: "object", additionalProperties: false, properties: { caseId: { type: "string" }, path: { type: "string", enum: ["recoverable", "customer-action", "restricted", "human-review"] }, action: { type: "string", enum: ["retry_payment", "send_update_reminder", "escalate_operator", "stop"] }, diagnosis: { type: "string" }, rationale: { type: "string" }, confidence: { type: "number" }, policyRule: { type: "string" }, requiresApproval: { type: "boolean" }, nextStep: { type: "string" }, stopReason: { type: "string" } }, required: ["caseId", "path", "action", "diagnosis", "rationale", "confidence", "policyRule", "requiresApproval", "nextStep", "stopReason"] } } } },
      });
      const content = response.choices?.[0]?.message?.content;
      try {
        const raw = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
        if (!Array.isArray(raw) || raw.length !== input.cases.length) throw new Error("Invalid AI batch recommendation count");
        return raw.map((item, index) => authorizeDecision(input.cases[index], validateDecision(item)));
      } catch (error) { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error instanceof Error ? error.message : "Invalid AI batch recommendation" }); }
    }),
  }),

  // TODO: add feature routers here, e.g.
  // todo: router({
  //   list: protectedProcedure.query(({ ctx }) =>
  //     db.getUserTodos(ctx.user.id)
  //   ),
  // }),
});

export type AppRouter = typeof appRouter;
