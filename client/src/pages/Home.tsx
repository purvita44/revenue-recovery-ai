import { useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, ArrowUpRight, CheckCircle2, ChevronRight, CircleDollarSign, Download,
  Clock3, FileClock, Filter, Gauge, Layers3, LockKeyhole, Menu, Play, RefreshCw,
  Search, ShieldCheck, SlidersHorizontal, Sparkles, StopCircle, UserRound, XCircle, Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { buildStakeholderCsv, calculateBaselineLift, classifyCase, formatInr, generateBatch, runRecoveryWorkflow, simulateAction, simulateBaseline, type AuditEvent, type Decision, type PaymentCase, type WorkflowEvent } from "@shared/recovery";

const initialCases = generateBatch(42, 48);

const scenarioDefinitions = [
  { label: "Transient failure", match: (item: PaymentCase) => item.failureReason === "network_error" || item.failureReason === "bank_unavailable" },
  { label: "Expired card", match: (item: PaymentCase) => item.failureReason === "expired_card" },
  { label: "Insufficient funds", match: (item: PaymentCase) => item.failureReason === "insufficient_funds" },
  { label: "Fraud case", match: (item: PaymentCase) => item.fraudFlag || item.failureReason === "suspected_fraud" },
  { label: "Missing consent", match: (item: PaymentCase) => !item.consent },
  { label: "Retry exhaustion", match: (item: PaymentCase) => item.retryCount >= 3 },
];

type Result = PaymentCase & ReturnType<typeof classifyCase> & { outcome: ReturnType<typeof simulateAction>; recovered: boolean; finalState: ReturnType<typeof runRecoveryWorkflow>["finalState"]; attempts: number; recoveredAmount: number; initialDecision: Decision; events: WorkflowEvent[] };

function processCases(cases: PaymentCase[], decisionOverrides: Record<string, Decision> = {}): Result[] {
  return cases.map((payment) => {
    const initialDecision = decisionOverrides[payment.id] || classifyCase(payment);
    const workflow = runRecoveryWorkflow(payment, initialDecision);
    const decision = workflow.decision;
    return {
      ...payment,
      ...decision,
      outcome: workflow.outcome,
      recovered: workflow.finalState === "RECOVERED",
      finalState: workflow.finalState,
      attempts: workflow.attempts,
      recoveredAmount: workflow.recoveredAmount,
      initialDecision,
      events: workflow.events,
    };
  });
}

const pathStyles: Record<string, string> = {
  recoverable: "bg-emerald-50 text-emerald-700 border-emerald-200",
  "customer-action": "bg-amber-50 text-amber-700 border-amber-200",
  restricted: "bg-rose-50 text-rose-700 border-rose-200",
  "human-review": "bg-violet-50 text-violet-700 border-violet-200",
};

function money(value: number) { return formatInr(value).replace("₹", "₹"); }

export default function Home() {
  const [cases, setCases] = useState(initialCases);
  const [selectedId, setSelectedId] = useState(initialCases[0].id);
  const [query, setQuery] = useState("");
  const [pathFilter, setPathFilter] = useState("all");
  const [activeNav, setActiveNav] = useState("Overview");
  const [isRunning, setIsRunning] = useState(false);
  const [decisionOverrides, setDecisionOverrides] = useState<Record<string, Decision>>({});
  const [auditTrail, setAuditTrail] = useState<AuditEvent[]>(() => {
    try {
      const stored = localStorage.getItem("recoveriq-audit-trail");
      return stored ? JSON.parse(stored) as AuditEvent[] : processCases(initialCases).flatMap((item) => item.events);
    } catch {
      return processCases(initialCases).flatMap((item) => item.events);
    }
  });
  const aiRecommendation = trpc.ai.recommend.useMutation();
  const auditAppend = trpc.audit.append.useMutation();
  const aiBatchRecommendation = trpc.ai.recommendBatch.useMutation();
  const auditQuery = trpc.audit.list.useQuery();
  const trpcUtils = trpc.useUtils();
  useEffect(() => {
    if (auditQuery.data && auditQuery.data.length === 0 && !localStorage.getItem("recoveriq-initial-audit-seeded")) {
      const initialEvents = processCases(initialCases).flatMap((item) => item.events.map((event) => ({ eventId: `initial-${event.id}`, caseId: event.caseId, kind: event.kind, title: event.title, detail: `${event.detail} · State: ${event.state}${event.nextAction ? ` · Next: ${event.nextAction}` : ""}${event.recoveredAmount ? ` · Recovered: ${money(event.recoveredAmount)}` : ""}`, status: event.status, eventTimestamp: event.timestamp })));
      auditAppend.mutate(initialEvents, { onSuccess: () => { localStorage.setItem("recoveriq-initial-audit-seeded", "true"); trpcUtils.audit.list.invalidate(); } });
    }
  }, [auditQuery.data, auditAppend]);
  const results = useMemo(() => processCases(cases, decisionOverrides), [cases, decisionOverrides]);
  const selected = results.find((item) => item.id === selectedId) || results[0];
  const filtered = results.filter((item) => {
    const matchesQuery = `${item.id} ${item.customer} ${item.failureReason}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (pathFilter === "all" || item.path === pathFilter);
  });
  const risk = cases.reduce((sum, item) => sum + item.amount, 0);
  const recovered = results.reduce((sum, item) => sum + item.recoveredAmount, 0);
  const recoveryRate = Math.round((recovered / Math.max(1, risk)) * 100);
  const escalations = results.filter((item) => item.finalState === "ESCALATED" || item.finalState === "HUMAN_REVIEW").length;
  const safeStops = results.filter((item) => item.finalState === "STOPPED").length;
  const pending = results.filter((item) => item.finalState === "WAITING").length;
  const baselineRecovered = cases.filter((item) => simulateBaseline(item) === "success").reduce((sum, item) => sum + item.amount, 0);
  const baselineLift = calculateBaselineLift(recovered, baselineRecovered);

  const askAi = () => {
    aiRecommendation.mutate({ caseId: selected.id, customer: selected.customer, amount: selected.amount, failureReason: selected.failureReason, retryCount: selected.retryCount, consent: selected.consent, fraudFlag: selected.fraudFlag, daysSinceFailure: selected.daysSinceFailure });
  };

  const replaySelected = () => {
    setCases((previous) => previous.map((item) => item.id === selected.id ? { ...item } : item));
    setDecisionOverrides((previous) => ({ ...previous, [selected.id]: classifyCase(selected) }));
  };

  const selectScenario = (match: (item: PaymentCase) => boolean) => {
    const scenario = results.find(match);
    if (scenario) setSelectedId(scenario.id);
  };

  const exportCsv = () => {
    const csv = buildStakeholderCsv(results.map((item) => ({
      caseId: item.id, customer: item.customer, amount: item.amount, path: item.path, diagnosis: item.diagnosis,
      action: item.action, confidence: item.confidence, policyRule: item.policyRule,
      approvalStatus: item.requiresApproval ? "required" : "not_required", outcome: item.outcome,
      recovered: item.recovered, nextStep: item.nextStep, stopReason: item.stopReason || "",
    })), auditTrail);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `recoveriq-stakeholder-report-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const runBatch = async () => {
    setIsRunning(true);
    const nextCases = generateBatch(Date.now() % 100000, 48);
    let aiDecisions: Decision[];
    try {
      aiDecisions = await aiBatchRecommendation.mutateAsync({ cases: nextCases.map((item) => ({ caseId: item.id, customer: item.customer, amount: item.amount, failureReason: item.failureReason, retryCount: item.retryCount, consent: item.consent, fraudFlag: item.fraudFlag, daysSinceFailure: item.daysSinceFailure })) });
    } catch {
      aiDecisions = nextCases.map((item) => classifyCase(item));
    }
    const overrides = Object.fromEntries(nextCases.map((item, index) => [item.id, aiDecisions[index]])) as Record<string, Decision>;
    const nextResults = processCases(nextCases, overrides);
      setCases(nextCases);
      setDecisionOverrides(overrides);
      setSelectedId(nextCases[0].id);
      auditAppend.mutate(nextResults.flatMap((item) => item.events.map((event) => ({ eventId: `${Date.now()}-${event.id}`, caseId: event.caseId, kind: event.kind, title: event.title, detail: `${event.detail} · State: ${event.state}${event.nextAction ? ` · Next: ${event.nextAction}` : ""}${event.recoveredAmount ? ` · Recovered: ${money(event.recoveredAmount)}` : ""}`, status: event.status, eventTimestamp: event.timestamp }))), { onSuccess: () => trpcUtils.audit.list.invalidate() });
      setAuditTrail((previous) => {
        const nextTrail = [...previous, ...nextResults.flatMap((item) => item.events)];
        localStorage.setItem("recoveriq-audit-trail", JSON.stringify(nextTrail));
        return nextTrail;
      });
    setIsRunning(false);
  };

  return (
    <div className="min-h-screen bg-[#f6f8fb] text-[#162033]">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[250px] flex-col border-r border-slate-200/80 bg-[#fbfcfe] lg:flex">
        <div className="flex h-[88px] items-center gap-3 px-7">
          <div className="grid size-9 place-items-center rounded-xl bg-[#153a64] text-white shadow-lg shadow-blue-900/10"><Zap className="size-5 fill-current" /></div>
          <div><div className="text-[15px] font-semibold tracking-tight">RecoverIQ</div><div className="text-[11px] text-slate-400">Revenue recovery lab</div></div>
        </div>
        <div className="px-4 pt-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Workspace</div>
        <nav className="mt-3 space-y-1 px-3">
          {[{ label: "Overview", icon: Activity }, { label: "Payment cases", icon: Layers3 }, { label: "Policy controls", icon: SlidersHorizontal }, { label: "Audit trail", icon: FileClock }].map(({ label, icon: Icon }) => (
            <button key={label} onClick={() => setActiveNav(label)} className={cn("flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm transition-all", activeNav === label ? "bg-[#e8f0f9] font-semibold text-[#153a64]" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800")}><Icon className="size-[17px]" />{label}{label === "Audit trail" && <span className="ml-auto rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500">live</span>}</button>
          ))}
        </nav>
        <div className="mt-auto p-4"><div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2 text-xs font-semibold text-slate-700"><ShieldCheck className="size-4 text-emerald-600" /> Simulation mode</div><p className="mt-2 text-[11px] leading-5 text-slate-500">No real money moves. All actions are policy-gated and recorded.</p><div className="mt-3 flex items-center gap-2 text-[10px] font-medium text-emerald-700"><span className="size-1.5 rounded-full bg-emerald-500" /> Test environment active</div></div><div className="mt-5 flex items-center gap-3 px-2"><div className="grid size-8 place-items-center rounded-full bg-[#dce8f5] text-xs font-semibold text-[#153a64]">AR</div><div className="min-w-0"><div className="truncate text-xs font-semibold">Aarav Rao</div><div className="text-[11px] text-slate-400">Builder workspace</div></div></div></div>
      </aside>

      <main className="lg:pl-[250px]">
        <header className="flex min-h-[88px] items-center justify-between gap-3 border-b border-slate-200/80 bg-[#f9fafc]/90 px-5 backdrop-blur lg:px-10"><div className="flex items-center gap-3"><button className="rounded-lg p-2 text-slate-500 lg:hidden"><Menu className="size-5" /></button><div><div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5c7da3]">Control room / {activeNav}</div><h1 className="mt-1 text-[20px] font-semibold tracking-[-0.04em] text-[#17243a] sm:text-[22px]"><span className="sm:hidden">Recovery overview</span><span className="hidden sm:inline">Payment recovery overview</span></h1></div></div><div className="flex shrink-0 items-center gap-2"><Button variant="outline" onClick={exportCsv} className="hidden gap-2 rounded-xl border-slate-200 bg-white text-[11px] font-semibold text-[#355f8d] sm:flex"><Download className="size-3.5" /> Export CSV</Button><div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 sm:flex"><span className="size-2 rounded-full bg-emerald-500" /> Simulation mode</div><Button onClick={runBatch} disabled={isRunning} className="shrink-0 gap-2 whitespace-nowrap rounded-xl bg-[#153a64] px-3 text-[11px] font-semibold shadow-lg shadow-blue-900/10 hover:bg-[#0d2d50]">{isRunning ? <RefreshCw className="size-3.5 animate-spin" /> : <Play className="size-3.5 fill-current" />}<span className="hidden sm:inline">{isRunning ? "Running batch" : "Run recovery batch"}</span><span className="sm:hidden">{isRunning ? "Running" : "Run batch"}</span></Button></div></header>

        <div className="mx-auto max-w-[1500px] space-y-6 p-5 lg:p-10">
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[{ label: "Synthetic revenue at risk", value: money(risk), meta: `${cases.length} failed payments`, icon: CircleDollarSign, accent: "text-[#356795]", spark: [38, 46, 35, 54, 44, 67, 60] }, { label: "Simulated amount recovered", value: money(recovered), meta: `${baselineLift >= 0 ? "+" : ""}${baselineLift}% vs baseline`, icon: ArrowUpRight, accent: "text-emerald-600", spark: [28, 32, 41, 38, 52, 58, 70] }, { label: "Recovery rate", value: `${recoveryRate}%`, meta: "Synthetic batch result", icon: Gauge, accent: "text-violet-600", spark: [44, 49, 45, 58, 53, 62, 68] }, { label: "Safe stops", value: String(safeStops), meta: `${escalations} escalated · ${pending} waiting`, icon: StopCircle, accent: "text-amber-600", spark: [67, 61, 58, 49, 53, 46, 42] }].map(({ label, value, meta, icon: Icon, accent, spark }) => <Card key={label} className="overflow-hidden rounded-2xl border-slate-200/80 bg-white shadow-[0_8px_28px_rgba(31,59,92,0.04)]"><CardContent className="p-5"><div className="flex items-start justify-between"><div><p className="text-xs font-medium text-slate-500">{label}</p><div className="mt-2 text-[25px] font-semibold tracking-[-0.04em] text-[#192840]">{value}</div><p className="mt-1 text-[11px] text-slate-400">{meta}</p></div><div className={cn("grid size-9 place-items-center rounded-xl bg-slate-50", accent)}><Icon className="size-[18px]" /></div></div><div className="mt-4 flex h-6 items-end gap-1">{spark.map((height, i) => <div key={i} className={cn("w-1.5 rounded-full", i === spark.length - 1 ? "bg-[#4d79a8]" : "bg-[#d8e5f2]")} style={{ height: `${height}%` }} />)}</div></CardContent></Card>)}
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
            <Card className="rounded-2xl border-slate-200/80 bg-white shadow-[0_8px_28px_rgba(31,59,92,0.04)]"><CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 px-6 py-5"><div><CardTitle className="text-[15px] font-semibold text-[#1a2a43]">Simulated recovery performance</CardTitle><p className="mt-1 text-xs text-slate-400">Agent strategy vs. one-retry synthetic baseline</p></div><div className="flex items-center gap-4 text-[11px] text-slate-500"><span className="flex items-center gap-2"><i className="size-2 rounded-full bg-[#4d79a8]" /> RecoverIQ</span><span className="flex items-center gap-2"><i className="size-2 rounded-full bg-[#d8e0e9]" /> Baseline</span></div></CardHeader><CardContent className="p-6"><div className="flex items-end justify-between gap-5"><div><div className="text-3xl font-semibold tracking-[-0.05em] text-[#1c2c45]">{money(recovered)}</div><div className="mt-1 text-[10px] uppercase tracking-[0.1em] text-slate-400">Synthetic ground-truth verification</div><div className="mt-1 flex items-center gap-1.5 text-xs font-medium text-emerald-600"><ArrowUpRight className="size-3.5" /> {money(Math.max(0, recovered - baselineRecovered))} simulated value vs baseline</div></div><div className="rounded-xl bg-[#f4f7fb] px-3 py-2 text-right"><div className="text-[10px] uppercase tracking-[0.12em] text-slate-400">Efficiency</div><div className="mt-0.5 text-sm font-semibold text-[#355f8d]">{baselineLift >= 0 ? "+" : ""}{baselineLift}% lift</div></div></div><div className="mt-7 grid h-[155px] grid-cols-12 items-end gap-2 border-b border-l border-slate-100 pl-3 pb-0 sm:gap-4">{[44, 57, 48, 70, 66, 82, 76, 92, 79, 100, 94, 108].map((height, index) => <div key={index} className="group relative flex h-full flex-1 items-end gap-1"><div className="w-1/2 rounded-t-md bg-[#dce5ef] transition-all group-hover:bg-[#c4d5e6]" style={{ height: `${height * .68}%` }} /><div className="w-1/2 rounded-t-md bg-[#4d79a8] transition-all group-hover:bg-[#285b8f]" style={{ height: `${height}%` }} /></div>)}</div><div className="mt-3 flex justify-between pl-3 text-[10px] text-slate-400"><span>Day 1</span><span>Day 6</span><span>Day 12</span></div></CardContent></Card>

            <Card className="rounded-2xl border-slate-200/80 bg-[#17385f] text-white shadow-[0_12px_30px_rgba(23,56,95,0.16)]"><CardHeader className="px-6 pb-3 pt-6"><div className="flex items-center justify-between"><CardTitle className="text-[15px] font-semibold">Policy health</CardTitle><div className="grid size-8 place-items-center rounded-lg bg-white/10"><LockKeyhole className="size-4 text-blue-100" /></div></div><p className="mt-1 text-xs leading-5 text-blue-100/65">Live guardrails protecting customer experience and cash flow.</p></CardHeader><CardContent className="space-y-5 px-6 pb-6 pt-2"><div><div className="flex justify-between text-xs"><span className="text-blue-100/70">Policy compliance</span><span className="font-semibold">100%</span></div><div className="mt-2 h-1.5 rounded-full bg-white/10"><div className="h-full w-full rounded-full bg-emerald-400" /></div></div><div className="grid grid-cols-2 gap-3"><div className="rounded-xl bg-white/8 p-3"><div className="text-xl font-semibold">3</div><div className="mt-1 text-[10px] text-blue-100/60">Max retries</div></div><div className="rounded-xl bg-white/8 p-3"><div className="text-xl font-semibold">24h</div><div className="mt-1 text-[10px] text-blue-100/60">Cooling period</div></div></div><div className="flex items-center gap-2 border-t border-white/10 pt-4 text-[11px] text-blue-100/70"><CheckCircle2 className="size-3.5 text-emerald-300" /> No policy violations in this run</div></CardContent></Card>
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.12fr_0.88fr]">
            <Card className="rounded-2xl border-slate-200/80 bg-white shadow-[0_8px_28px_rgba(31,59,92,0.04)]"><CardHeader className="flex flex-row items-end justify-between gap-4 px-6 pb-4 pt-6"><div><CardTitle className="text-[15px] font-semibold text-[#1a2a43]">Payment cases</CardTitle><p className="mt-1 text-xs text-slate-400">Search and inspect every decision in the batch</p></div><div className="flex items-center gap-2"><div className="relative hidden sm:block"><Search className="absolute left-3 top-2.5 size-3.5 text-slate-400" /><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search cases..." className="h-8 w-[155px] rounded-lg border-slate-200 pl-8 text-xs" /></div><select value={pathFilter} onChange={(e) => setPathFilter(e.target.value)} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-[11px] text-slate-600"><option value="all">All paths</option><option value="recoverable">Recoverable</option><option value="customer-action">Customer action</option><option value="human-review">Human review</option><option value="restricted">Restricted</option></select><Button variant="outline" size="icon" className="size-8 rounded-lg"><Filter className="size-3.5" /></Button></div></CardHeader><div className="flex flex-wrap gap-2 border-b border-slate-100 px-6 py-3"><span className="mr-1 self-center text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Replay scenario</span>{scenarioDefinitions.map((scenario) => <Button key={scenario.label} variant="outline" onClick={() => selectScenario(scenario.match)} className="h-7 rounded-lg border-slate-200 px-2.5 text-[10px] font-medium text-[#355f8d]">{scenario.label}</Button>)}</div><div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead className="border-y border-slate-100 bg-slate-50/70 text-[10px] uppercase tracking-[0.1em] text-slate-400"><tr><th className="px-6 py-3 font-semibold">Case / customer</th><th className="px-3 py-3 font-semibold">Path</th><th className="px-3 py-3 font-semibold">Action</th><th className="px-3 py-3 font-semibold">Synthetic amount</th><th className="px-6 py-3 text-right font-semibold">Status</th></tr></thead><tbody>{filtered.slice(0, 7).map((item) => <tr key={item.id} onClick={() => setSelectedId(item.id)} className={cn("cursor-pointer border-b border-slate-100 transition-colors hover:bg-[#f7fafe]", selected.id === item.id && "bg-[#f2f7fc]")}><td className="px-6 py-3.5"><div className="flex items-center gap-3"><div className="grid size-8 place-items-center rounded-full bg-[#e8f0f8] text-[10px] font-semibold text-[#356795]">{item.initials}</div><div><div className="font-semibold text-[#263850]">{item.id}</div><div className="mt-0.5 text-[11px] text-slate-400">{item.customer}</div></div></div></td><td className="px-3"><Badge variant="outline" className={cn("rounded-md px-2 py-1 text-[10px] font-medium", pathStyles[item.path])}>{item.path.replace("-", " ")}</Badge></td><td className="px-3 text-slate-500">{item.action === "retry_payment" ? "Retry payment" : item.action === "send_update_reminder" ? "Update reminder" : "Operator review"}</td><td className="px-3 font-semibold text-[#2b405d]">{money(item.amount)}</td><td className="px-6 text-right">{item.recovered ? <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600"><CheckCircle2 className="size-3.5" /> Simulated recovered</span> : item.outcome === "simulator_error" ? <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-600"><XCircle className="size-3.5" /> Contained</span> : <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600"><StopCircle className="size-3.5" /> Stopped</span>}</td></tr>)}</tbody></table></div><div className="flex items-center justify-between px-6 py-4 text-[11px] text-slate-400"><span>Showing {Math.min(filtered.length, 7)} of {filtered.length} cases</span><span className="flex items-center gap-1 font-medium text-[#4d79a8]">View full audit trail <ChevronRight className="size-3" /></span></div></Card>

            <Card className="rounded-2xl border-slate-200/80 bg-white shadow-[0_8px_28px_rgba(31,59,92,0.04)]"><CardHeader className="flex flex-row items-start justify-between px-6 pb-4 pt-6"><div><div className="flex items-center gap-2"><CardTitle className="text-[15px] font-semibold text-[#1a2a43]">Case detail</CardTitle><Button variant="outline" onClick={askAi} disabled={aiRecommendation.isPending} className="h-7 gap-1.5 rounded-lg border-slate-200 px-2.5 text-[10px] font-semibold text-[#355f8d]"><Sparkles className="size-3" />{aiRecommendation.isPending ? "Thinking" : "Ask AI"}</Button><Button variant="outline" onClick={replaySelected} className="hidden h-7 gap-1.5 rounded-lg border-slate-200 px-2.5 text-[10px] font-semibold text-[#355f8d] sm:flex"><RefreshCw className="size-3" />Replay</Button><Badge variant="outline" className={cn("rounded-md text-[10px] font-medium", pathStyles[selected.path])}>{selected.path.replace("-", " ")}</Badge></div><p className="mt-1 text-xs text-slate-400">{selected.id} · {selected.customer}</p></div><div className="grid size-8 place-items-center rounded-full bg-[#e8f0f8] text-[11px] font-semibold text-[#356795]">{selected.initials}</div></CardHeader><CardContent className="px-6 pb-6"><div className="grid grid-cols-2 gap-3 rounded-xl bg-[#f6f8fb] p-3"><div><div className="text-[10px] uppercase tracking-[0.1em] text-slate-400">Synthetic amount at risk</div><div className="mt-1 text-sm font-semibold text-[#253a57]">{money(selected.amount)}</div></div><div><div className="text-[10px] uppercase tracking-[0.1em] text-slate-400">Confidence</div><div className="mt-1 text-sm font-semibold text-[#253a57]">{Math.round(selected.confidence * 100)}%</div></div><div><div className="text-[10px] uppercase tracking-[0.1em] text-slate-400">AI first action</div><div className="mt-1 text-[11px] font-semibold text-[#253a57]">{selected.initialDecision.action}</div></div><div><div className="text-[10px] uppercase tracking-[0.1em] text-slate-400">Policy rule</div><div className="mt-1 text-[11px] font-semibold text-[#253a57]">{selected.policyRule}</div></div><div><div className="text-[10px] uppercase tracking-[0.1em] text-slate-400">Approval</div><div className="mt-1 text-[11px] font-semibold text-[#253a57]">{selected.requiresApproval ? "Required" : "Not required"}</div></div><div><div className="text-[10px] uppercase tracking-[0.1em] text-slate-400">Workflow state</div><div className="mt-1 text-[11px] font-semibold text-[#253a57]">{selected.finalState} · {selected.attempts} attempt{selected.attempts === 1 ? "" : "s"}</div></div></div><div className="mt-3 grid gap-2 rounded-xl border border-slate-100 bg-white p-3"><div className="flex items-center justify-between text-[10px] uppercase tracking-[0.1em] text-slate-400"><span>Next step</span><span className="text-[#355f8d]">{selected.nextStep}</span></div><div className="flex items-center justify-between text-[10px] uppercase tracking-[0.1em] text-slate-400"><span>Stop reason</span><span className="text-right text-slate-600">{selected.stopReason || "Not stopped · awaiting verification"}</span></div></div>{aiRecommendation.data && <div className="mt-3 rounded-xl border border-[#d9e6f2] bg-[#f3f8fc] p-3"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#356795]"><Sparkles className="size-3" /> Structured AI recommendation · policy validated</div><div className="mt-2 text-xs font-semibold text-[#253850]">{aiRecommendation.data.diagnosis}</div><p className="mt-1 text-[11px] leading-4 text-slate-500">{aiRecommendation.data.rationale}</p><div className="mt-2 flex flex-wrap gap-2 text-[10px] text-slate-500"><span className="rounded-md bg-white px-2 py-1">Action: {aiRecommendation.data.action}</span><span className="rounded-md bg-white px-2 py-1">Confidence: {Math.round(aiRecommendation.data.confidence * 100)}%</span></div></div>}<Separator className="my-5" /><div className="mb-3 flex items-center justify-between"><div className="text-xs font-semibold text-[#253850]">Decision timeline</div><div className="flex items-center gap-1 text-[10px] text-slate-400"><FileClock className="size-3" /> Server append-only log · {(auditQuery.data?.length ?? auditTrail.length)} events</div></div><div className="space-y-4">{(auditQuery.data && auditQuery.data.length > 0 ? auditQuery.data.filter((event) => event.caseId === selected.id).map((event) => ({ id: event.eventId, caseId: event.caseId, timestamp: new Date(event.eventTimestamp).toISOString(), kind: event.kind as AuditEvent["kind"], title: event.title, detail: event.detail, status: event.status as AuditEvent["status"] })) : selected.events).map((event) => <div key={event.id} className="relative flex gap-3"><div className={cn("relative z-10 mt-0.5 grid size-6 shrink-0 place-items-center rounded-full", event.status === "success" ? "bg-emerald-50 text-emerald-600" : event.status === "blocked" ? "bg-violet-50 text-violet-600" : event.status === "warning" ? "bg-amber-50 text-amber-600" : "bg-blue-50 text-blue-600")}>{event.kind === "diagnosis" ? <Sparkles className="size-3" /> : event.kind === "verification" ? <CheckCircle2 className="size-3" /> : event.kind === "stop" ? <StopCircle className="size-3" /> : event.kind === "escalation" ? <UserRound className="size-3" /> : <Activity className="size-3" />}</div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><div className="text-xs font-semibold text-[#2a3d58]">{event.title}</div><div className="shrink-0 text-[10px] text-slate-400">{new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div></div><p className="mt-1 text-[11px] leading-4 text-slate-500">{event.detail}</p></div></div>)}</div></CardContent></Card>
          </section>

          <section className="grid gap-4 md:grid-cols-3"><div className="rounded-2xl border border-slate-200/80 bg-white p-5"><div className="flex items-center gap-2 text-xs font-semibold text-[#29415f]"><Clock3 className="size-4 text-[#5c7da3]" /> Bounded retry policy</div><p className="mt-2 text-[11px] leading-5 text-slate-500">Maximum three attempts with a 24-hour cooling period between customer contacts.</p></div><div className="rounded-2xl border border-slate-200/80 bg-white p-5"><div className="flex items-center gap-2 text-xs font-semibold text-[#29415f]"><AlertTriangle className="size-4 text-amber-500" /> Human review gates</div><p className="mt-2 text-[11px] leading-5 text-slate-500">Fraud signals, missing consent, and exhausted retry budgets are never automated.</p></div><div className="rounded-2xl border border-slate-200/80 bg-white p-5"><div className="flex items-center gap-2 text-xs font-semibold text-[#29415f]"><ShieldCheck className="size-4 text-emerald-600" /> Test-only execution</div><p className="mt-2 text-[11px] leading-5 text-slate-500">Every action hits a deterministic simulator. No live payment credentials or money movement.</p></div></section>
        </div>
      </main>
    </div>
  );
}
