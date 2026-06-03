import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { Inbox, MessageSquarePlus, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import {
  addFeedbackComment,
  clearFeedbackComments,
  deleteFeedback,
  listFeedback,
  submitFeedback,
  updateFeedback,
  updateFeedbackStatus,
  type FeedbackComment,
  type FeedbackKind,
  type FeedbackRecord,
  type FeedbackStatus,
} from "@/api/client";
import { useAppVersion } from "@/hooks/use-app-version";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type FeedbackDialogProps = {
  activeTab: string;
  project?: string;
  workspacePath?: string;
};

const KIND_LABELS: Array<{ value: FeedbackKind; label: string }> = [
  { value: "bug", label: "Bug" },
  { value: "feature", label: "Feature" },
  { value: "ui", label: "UI change" },
  { value: "chore", label: "Chore" },
  { value: "question", label: "Question" },
  { value: "other", label: "Other" },
];

const STATUS_LABELS: Array<{ value: FeedbackStatus; label: string }> = [
  { value: "new", label: "New" },
  { value: "planned", label: "Planned" },
  { value: "accepted", label: "Accepted" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "wontfix", label: "Won't fix" },
];

const ACTIVE_STATUSES = new Set<FeedbackStatus>(["new", "planned", "accepted", "in_progress"]);

const STATUS_TABS: Array<{ value: FeedbackStatus; label: string }> = [
  { value: "new", label: "New" },
  { value: "planned", label: "Planned" },
  { value: "accepted", label: "Accepted" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "wontfix", label: "Won't fix" },
];

function statusLabel(status: FeedbackStatus) {
  return status.replace("_", " ");
}

function TooltipButton({
  tooltip,
  children,
  ...props
}: ButtonProps & { tooltip: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button {...props}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 leading-relaxed">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

export function FeedbackDialog({ activeTab, project, workspacePath }: FeedbackDialogProps) {
  const appVersion = useAppVersion();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("submit");
  const [statusTab, setStatusTab] = useState<FeedbackStatus>("new");
  const [kind, setKind] = useState<FeedbackKind>("feature");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [records, setRecords] = useState<FeedbackRecord[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editKind, setEditKind] = useState<FeedbackKind>("feature");
  const [editStatus, setEditStatus] = useState<FeedbackStatus>("new");
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editPlan, setEditPlan] = useState("");
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});

  const route = useMemo(() => {
    const base = `/${activeTab}`;
    return project ? `${base}/${project}` : base;
  }, [activeTab, project]);

  const activeRecords = useMemo(
    () => records.filter((record) => ACTIVE_STATUSES.has(record.status)),
    [records]
  );

  const countsByStatus = useMemo(() => {
    const counts: Partial<Record<FeedbackStatus, number>> = {};
    for (const record of records) {
      counts[record.status] = (counts[record.status] ?? 0) + 1;
    }
    return counts;
  }, [records]);

  const visibleRecords = useMemo(
    () => records.filter((record) => record.status === statusTab),
    [records, statusTab]
  );

  async function refreshRecords() {
    setLoadingRecords(true);
    try {
      const nextRecords = await listFeedback();
      setRecords(nextRecords.slice().reverse());
    } catch (error) {
      toast.error("Failed to load agent inbox", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoadingRecords(false);
    }
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey && event.key === "/")) return;
      event.preventDefault();
      setOpen(true);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    void refreshRecords();
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedBody = body.trim();
    if (!trimmedBody) {
      toast.error("Describe what should change first");
      return;
    }

    setSubmitting(true);
    try {
      const response = await submitFeedback({
        kind,
        title: title.trim() || null,
        body: trimmedBody,
        app: "tiles",
        environment: import.meta.env.DEV ? "dev" : "production",
        route,
        url: window.location.href,
        createdAt: new Date().toISOString(),
        context: {
          activeTab,
          project: project ?? null,
          workspace: workspacePath ?? null,
          appVersion: appVersion || null,
        },
      });
      toast.success("Sent to agent inbox", {
        description: `${response.id} → ${response.path}`,
      });
      setTitle("");
      setBody("");
      setKind("feature");
      setTab("inbox");
      await refreshRecords();
    } catch (error) {
      toast.error("Failed to submit feedback", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function setRecordStatus(id: string, status: FeedbackStatus) {
    try {
      await updateFeedbackStatus(id, status);
      await refreshRecords();
      toast.success(`Marked ${statusLabel(status)}`);
    } catch (error) {
      toast.error("Failed to update feedback", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function startEdit(record: FeedbackRecord) {
    setEditingId(record.id);
    setEditKind(record.kind);
    setEditStatus(record.status);
    setEditTitle(record.title ?? "");
    setEditBody(record.body);
    setEditPlan(record.plan ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditTitle("");
    setEditBody("");
    setEditPlan("");
  }

  async function saveEdit() {
    if (!editingId) return;
    if (!editBody.trim()) {
      toast.error("Feedback body is required");
      return;
    }

    try {
      await updateFeedback({
        id: editingId,
        kind: editKind,
        status: editStatus,
        title: editTitle.trim() || null,
        body: editBody.trim(),
        plan: editPlan.trim() || null,
      });
      cancelEdit();
      await refreshRecords();
      toast.success("Feedback updated");
    } catch (error) {
      toast.error("Failed to update feedback", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function removeRecord(record: FeedbackRecord) {
    const label = record.title || record.body.slice(0, 80) || record.id;
    if (!window.confirm(`Delete this inbox item?\n\n${label}`)) return;

    try {
      await deleteFeedback(record.id);
      if (editingId === record.id) cancelEdit();
      await refreshRecords();
      toast.success("Feedback deleted");
    } catch (error) {
      toast.error("Failed to delete feedback", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function copyPrompt(prompt: string) {
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success("Agent prompt copied");
    } catch (error) {
      toast.error("Failed to copy prompt", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function allInboxPrompt(mode: "plan" | "implement" | "yolo") {
    const ids = activeRecords.map((record) => `- ${record.id}: ${record.title || record.body.slice(0, 80)} [${record.kind}/${record.status}]`).join("\n");

    if (mode === "plan") {
      return `Let's discuss the active agent inbox items and make concise implementation plans. Do not code yet.\n\nRead .agent/inbox/README.md first, then inspect .agent/inbox/feedback.jsonl. Focus on these active items:\n${ids || "- No active items currently shown in the UI."}\n\nAfter each plan is agreed, update the JSONL record yourself with the crystallized plan, status=planned, updatedAt, and an agentNotes entry. Do not make the user copy/paste plans from chat into the UI.`;
    }

    if (mode === "implement") {
      return `Implement the accepted agent inbox items.\n\nRead .agent/inbox/README.md first, then inspect .agent/inbox/feedback.jsonl. Focus on accepted items from this active list:\n${ids || "- No active items currently shown in the UI."}\n\nUse each item's plan field as the source of truth. Set items to in_progress before editing, run targeted validation, then mark completed items done with an agentNotes summary. Skip items that are not accepted.`;
    }

    return `Implement all active agent inbox items now. Skip planning — just do the work.\n\nRead .agent/inbox/README.md first, then inspect .agent/inbox/feedback.jsonl. Work through all active items from this list:\n${ids || "- No active items currently shown in the UI."}\n\nFor each item: set status to in_progress, implement it using your best judgement, run targeted validation, then mark it done with an agentNotes summary. Do not stop to plan or ask for approval unless something is genuinely ambiguous or risky.`;
  }

  function itemPrompt(record: FeedbackRecord, mode: "plan" | "implement" | "yolo") {
    const plan = record.plan ? `\n\nAccepted plan:\n${record.plan}` : "";

    if (mode === "plan") {
      return `Let's discuss this agent inbox item and make a concise plan. Do not code yet.\n\nRead .agent/inbox/README.md first, then inspect .agent/inbox/feedback.jsonl. Focus on item ${record.id}.\n\nTitle: ${record.title || "(none)"}\nKind/status: ${record.kind}/${record.status}\nRoute: ${record.route || "unknown"}\nBody:\n${record.body}${plan}\n\nUpdate this JSONL record yourself with the crystallized plan, status=planned, updatedAt, and an agentNotes entry. Do not make the user copy/paste plans from chat into the UI.`;
    }

    if (mode === "implement") {
      return `Implement agent inbox item ${record.id} using the accepted plan.\n\nRead .agent/inbox/README.md first, then inspect .agent/inbox/feedback.jsonl.\n\nTitle: ${record.title || "(none)"}\nKind/status: ${record.kind}/${record.status}\nRoute: ${record.route || "unknown"}\nBody:\n${record.body}${plan}\n\nSet this item to in_progress before editing, implement the accepted plan, run targeted validation, then mark it done with an agentNotes summary.`;
    }

    return `Implement agent inbox item ${record.id} now. Skip planning — just do the work.\n\nRead .agent/inbox/README.md first, then inspect .agent/inbox/feedback.jsonl.\n\nTitle: ${record.title || "(none)"}\nKind/status: ${record.kind}/${record.status}\nRoute: ${record.route || "unknown"}\nBody:\n${record.body}${plan}\n\nSet this item to in_progress before editing, implement it using your best judgement, run targeted validation, then mark it done with an agentNotes summary. Do not stop to plan or ask for approval unless something is genuinely ambiguous or risky.`;
  }

  async function submitComment(record: FeedbackRecord) {
    const body = (commentInputs[record.id] ?? "").trim();
    if (!body) return;
    try {
      await addFeedbackComment(record.id, "user", body);
      setCommentInputs((prev) => ({ ...prev, [record.id]: "" }));
      await refreshRecords();
    } catch (error) {
      toast.error("Failed to add comment", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function compactThread(record: FeedbackRecord) {
    try {
      await clearFeedbackComments(record.id);
      await refreshRecords();
      toast.success("Thread cleared — paste the compact prompt to finish");
    } catch (error) {
      toast.error("Failed to clear thread", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function threadDiscussPrompt(record: FeedbackRecord, comment: FeedbackComment) {
    const thread = (record.comments ?? [])
      .map((c) => `[${c.from}] ${c.body}`)
      .join("\n\n");
    return `Read this comment thread for agent inbox item ${record.id} and respond in the thread.\n\nRead .agent/inbox/README.md first, then inspect .agent/inbox/feedback.jsonl.\n\nCurrent plan:\n${record.plan || "(none)"}\n\nThread so far:\n${thread}\n\nLatest comment from user:\n${comment.body}\n\nPost your response by appending an agent comment to the record's comments array in feedback.jsonl (from: "agent"). Do not change the plan or status unless asked.`;
  }

  function threadRevisePlanPrompt(record: FeedbackRecord, comment: FeedbackComment) {
    const thread = (record.comments ?? [])
      .map((c) => `[${c.from}] ${c.body}`)
      .join("\n\n");
    return `Revise the plan for agent inbox item ${record.id} based on the comment thread.\n\nRead .agent/inbox/README.md first, then inspect .agent/inbox/feedback.jsonl.\n\nCurrent plan:\n${record.plan || "(none)"}\n\nThread so far:\n${thread}\n\nLatest comment from user:\n${comment.body}\n\nRewrite the plan field with the revised approach, then append an agent comment (from: "agent") summarising what changed. Keep status as planned.`;
  }

  function compactThreadPrompt(record: FeedbackRecord) {
    const thread = (record.comments ?? [])
      .map((c) => `[${c.from}] ${c.body}`)
      .join("\n\n");
    return `Compact the discussion thread for agent inbox item ${record.id} into a final concise plan.\n\nRead .agent/inbox/README.md first, then inspect .agent/inbox/feedback.jsonl.\n\nCurrent plan:\n${record.plan || "(none)"}\n\nFull thread:\n${thread}\n\nProduce the definitive plan from this discussion. Write it to the plan field, add one agentNotes entry summarising the thread resolution, then clear the comments array. Keep status as planned — the user will Accept when ready.`;
  }

  function promoteIssuePrompt(record: FeedbackRecord) {
    return `Create a GitHub issue for agent inbox item ${record.id}.\n\nRead .agent/inbox/README.md first, then inspect .agent/inbox/feedback.jsonl. Use the original body and plan below to write a concise, actionable issue with acceptance criteria. Do not implement code. After creating/proposing the issue, update linkedIssue/status if supported.\n\nTitle: ${record.title || "(none)"}\nKind/status: ${record.kind}/${record.status}\nRoute: ${record.route || "unknown"}\nBody:\n${record.body}\n\nPlan:\n${record.plan || "(no plan yet)"}`;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquarePlus className="h-5 w-5" />
            Agent inbox
          </DialogTitle>
          <DialogDescription>
            Press <kbd className="rounded border px-1">⌘/</kbd> anywhere to file or review local agent-readable work items.
          </DialogDescription>
        </DialogHeader>

        <TooltipProvider delayDuration={200}>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="submit">Submit</TabsTrigger>
            <TabsTrigger value="inbox">
              Inbox{(countsByStatus["new"] ?? 0) > 0 ? ` (${countsByStatus["new"]})` : ""}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="submit">
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
                <div className="space-y-2">
                  <Label htmlFor="feedback-kind">Type</Label>
                  <Select value={kind} onValueChange={(value) => setKind(value as FeedbackKind)}>
                    <SelectTrigger id="feedback-kind" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {KIND_LABELS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="feedback-title">Title <span className="text-muted-foreground">optional</span></Label>
                  <Input
                    id="feedback-title"
                    placeholder="Short summary"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="feedback-body">What should change?</Label>
                <textarea
                  id="feedback-body"
                  className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-36 w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="Describe the bug, feature request, or UI tweak..."
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  autoFocus
                />
              </div>

              <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                Captures route <span className="font-mono">{route}</span>
                {workspacePath ? <> and workspace <span className="font-mono">{workspacePath}</span></> : null}.
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Sending…" : "Send"}
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>

          <TabsContent value="inbox" className="space-y-3">
            <div className="flex flex-wrap gap-1">
              {STATUS_TABS.map(({ value, label }) => {
                const count = countsByStatus[value] ?? 0;
                const isActive = statusTab === value;
                return (
                  <button
                    key={value}
                    onClick={() => setStatusTab(value)}
                    className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {label}
                    {count > 0 && (
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] leading-none ${isActive ? "bg-primary-foreground/20 text-primary-foreground" : "bg-background text-foreground"}`}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <div className="flex flex-wrap gap-2">
                <TooltipButton
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copyPrompt(allInboxPrompt("plan"))}
                  tooltip="Agent discusses and plans all active items. No code yet."
                >
                  Plan all
                </TooltipButton>
                <TooltipButton
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copyPrompt(allInboxPrompt("implement"))}
                  tooltip="Agent implements all accepted items using their saved plans."
                >
                  Implement accepted
                </TooltipButton>
                <TooltipButton
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copyPrompt(allInboxPrompt("yolo"))}
                  tooltip="Agent implements all active items immediately. No planning step."
                >
                  Yolo all
                </TooltipButton>
                <TooltipButton
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={refreshRecords}
                  disabled={loadingRecords}
                  tooltip="Reloads the inbox from disk to reflect the latest agent changes."
                >
                  {loadingRecords ? "Loading…" : "Refresh"}
                </TooltipButton>
              </div>
            </div>

            <div className="max-h-[380px] space-y-2 overflow-y-auto pr-1">
              {visibleRecords.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  <Inbox className="mb-2 h-6 w-6" />
                  No {STATUS_TABS.find(s => s.value === statusTab)?.label.toLowerCase()} items.
                </div>
              )}

              {visibleRecords.map((record) => {
                const isEditing = editingId === record.id;

                return (
                  <div key={record.id} className="rounded-lg border bg-card p-3 text-sm">
                    {isEditing ? (
                      <div className="space-y-3">
                        <div className="grid gap-2 sm:grid-cols-[150px_150px_1fr]">
                          <div className="space-y-2">
                            <Label>Type</Label>
                            <Select value={editKind} onValueChange={(value) => setEditKind(value as FeedbackKind)}>
                              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {KIND_LABELS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label>Status</Label>
                            <Select value={editStatus} onValueChange={(value) => setEditStatus(value as FeedbackStatus)}>
                              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {STATUS_LABELS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label>Title <span className="text-muted-foreground">optional</span></Label>
                            <Input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>Body</Label>
                          <textarea
                            className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-28 w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
                            value={editBody}
                            onChange={(event) => setEditBody(event.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Plan <span className="text-muted-foreground">optional, accept means approving this</span></Label>
                          <textarea
                            className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-32 w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
                            placeholder="Concise implementation plan, acceptance criteria, open questions..."
                            value={editPlan}
                            onChange={(event) => setEditPlan(event.target.value)}
                          />
                        </div>
                        <div className="flex justify-end gap-2">
                          <TooltipButton size="sm" variant="outline" onClick={cancelEdit} tooltip="Discard your draft edits and return to the inbox item view.">Cancel</TooltipButton>
                          <TooltipButton size="sm" onClick={saveEdit} tooltip="Save edits back to the local agent inbox JSONL file.">Save</TooltipButton>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {record.kind}
                            </span>
                            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                              {statusLabel(record.status)}
                            </span>
                            <span className="font-mono text-xs text-muted-foreground">{record.id}</span>
                          </div>
                          <div className="mt-2 font-medium">{record.title || record.body.slice(0, 80)}</div>
                          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{record.body}</p>
                          {record.plan && (
                            <div className="mt-3 rounded-md border bg-muted/30 p-2">
                              <div className="mb-1 text-xs font-medium text-muted-foreground">Plan</div>
                              <p className="whitespace-pre-wrap text-muted-foreground">{record.plan}</p>
                            </div>
                          )}
                          {record.status === "planned" && (
                            <div className="mt-3 space-y-2">
                              {(record.comments ?? []).length > 0 && (
                                <div className="space-y-2">
                                  {(record.comments ?? []).map((comment) => (
                                    <div
                                      key={comment.id}
                                      className={`rounded-md border p-2 text-sm ${comment.from === "agent" ? "bg-primary/5 border-primary/20" : "bg-muted/30"}`}
                                    >
                                      <div className="mb-1 flex items-center justify-between gap-2">
                                        <span className="text-xs font-medium text-muted-foreground capitalize">{comment.from}</span>
                                        <span className="text-xs text-muted-foreground">{comment.createdAt.slice(0, 16).replace("T", " ")}</span>
                                      </div>
                                      <p className="whitespace-pre-wrap">{comment.body}</p>
                                      {comment.from === "user" && (
                                        <div className="mt-2 flex gap-1.5">
                                          <TooltipButton
                                            size="sm"
                                            variant="outline"
                                            className="h-6 text-xs"
                                            onClick={() => copyPrompt(threadDiscussPrompt(record, comment))}
                                            tooltip="Agent reads the thread and responds without changing the plan."
                                          >
                                            Discuss
                                          </TooltipButton>
                                          <TooltipButton
                                            size="sm"
                                            variant="outline"
                                            className="h-6 text-xs"
                                            onClick={() => copyPrompt(threadRevisePlanPrompt(record, comment))}
                                            tooltip="Agent reads the thread and rewrites the plan based on your feedback."
                                          >
                                            Revise plan
                                          </TooltipButton>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                              <div className="flex gap-2">
                                <textarea
                                  className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-16 flex-1 rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
                                  placeholder="Push back on the plan…"
                                  value={commentInputs[record.id] ?? ""}
                                  onChange={(e) => setCommentInputs((prev) => ({ ...prev, [record.id]: e.target.value }))}
                                  onKeyDown={(e) => { if (e.key === "Enter" && e.metaKey) void submitComment(record); }}
                                />
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="self-end"
                                  disabled={!(commentInputs[record.id] ?? "").trim()}
                                  onClick={() => void submitComment(record)}
                                >
                                  Send
                                </Button>
                              </div>
                              {(record.comments ?? []).some((c) => c.from === "agent") && (
                                <TooltipButton
                                  size="sm"
                                  variant="outline"
                                  className="w-full"
                                  onClick={() => { void copyPrompt(compactThreadPrompt(record)); void compactThread(record); }}
                                  tooltip="Agent collapses the thread into a final concise plan. Use when satisfied with the discussion."
                                >
                                  Compact thread
                                </TooltipButton>
                              )}
                            </div>
                          )}
                          <div className="mt-2 text-xs text-muted-foreground">
                            {record.route || "unknown route"} · {record.createdAt}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          {record.status === "planned" && (
                            <TooltipButton
                              size="sm"
                              onClick={() => setRecordStatus(record.id, "accepted")}
                              tooltip="Approve the agent's plan."
                            >
                              Accept
                            </TooltipButton>
                          )}
                          {record.status === "accepted" && (
                            <TooltipButton
                              size="sm"
                              variant="outline"
                              onClick={() => copyPrompt(itemPrompt(record, "implement"))}
                              tooltip="Copies a prompt telling the agent to implement this item using the saved plan."
                            >
                              Copy implement
                            </TooltipButton>
                          )}
                          {record.status === "new" && (
                            <>
                              <TooltipButton
                                size="sm"
                                variant="outline"
                                onClick={() => copyPrompt(itemPrompt(record, "plan"))}
                                tooltip="Copies a prompt asking the agent to discuss and plan this item before touching code."
                              >
                                Copy plan
                              </TooltipButton>
                              <TooltipButton
                                size="sm"
                                variant="outline"
                                onClick={() => copyPrompt(itemPrompt(record, "yolo"))}
                                tooltip="Copies a prompt telling the agent to implement this item immediately, no planning step."
                              >
                                Yolo
                              </TooltipButton>
                            </>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => startEdit(record)}>Edit</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => copyPrompt(promoteIssuePrompt(record))}>Promote to issue</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => setRecordStatus(record.id, "wontfix")}>Won't fix</DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => removeRecord(record)}>Delete</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  );
}
