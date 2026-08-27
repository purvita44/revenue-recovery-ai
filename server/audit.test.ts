import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

describe("audit router", () => {
  it("persists a uniquely identified event and returns it in the ordered audit list", async () => {
    const ctx: TrpcContext = {
      user: null,
      req: {} as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);
    const eventId = `audit-test-${Date.now()}`;
    const timestamp = new Date();
    const appended = await caller.audit.append([{ eventId, caseId: "AUDIT-TEST", kind: "verification", title: "Persistence test", detail: "Server audit persistence verified", status: "success", eventTimestamp: timestamp }]);
    const listed = await caller.audit.list();
    const persisted = listed.find((event) => event.eventId === eventId);
    expect(appended).toHaveLength(1);
    expect(persisted).toMatchObject({ eventId, caseId: "AUDIT-TEST", title: "Persistence test", status: "success" });
    expect(persisted?.eventTimestamp).toBeInstanceOf(Date);
  });
});
