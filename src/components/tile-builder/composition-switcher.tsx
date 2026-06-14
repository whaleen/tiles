import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChevronDown, Copy, Layers, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { CompositionSummary } from "@/types";

type DialogMode = "new" | "saveAs" | "rename";

interface CompositionSwitcherProps {
  compositions: CompositionSummary[];
  activeName: string | null;
  onSwitch: (name: string) => Promise<void> | void;
  onNew: (name: string) => Promise<void> | void;
  onSaveAs: (name: string) => Promise<void> | void;
  onRename: (from: string, to: string) => Promise<void> | void;
  onDelete: (name: string) => Promise<void> | void;
}

export function CompositionSwitcher({
  compositions,
  activeName,
  onSwitch,
  onNew,
  onSaveAs,
  onRename,
  onDelete,
}: CompositionSwitcherProps) {
  const [dialog, setDialog] = useState<DialogMode | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const names = new Set(compositions.map((c) => c.name));
  const canDelete = compositions.length > 1 && !!activeName;

  function openDialog(mode: DialogMode) {
    setDialog(mode);
    setName(
      mode === "rename"
        ? activeName ?? ""
        : mode === "saveAs"
          ? `${activeName ?? "Composition"} copy`
          : ""
    );
  }

  const trimmed = name.trim();
  const nameError =
    trimmed.length === 0
      ? "Name is required"
      : trimmed.includes("/") || trimmed.includes("\\") || trimmed.startsWith(".")
        ? "Invalid name"
        : dialog !== "rename" && names.has(trimmed)
          ? "A composition with that name already exists"
          : dialog === "rename" && trimmed !== activeName && names.has(trimmed)
            ? "A composition with that name already exists"
            : null;

  async function confirm() {
    if (!dialog || nameError) return;
    setBusy(true);
    try {
      if (dialog === "new") await onNew(trimmed);
      else if (dialog === "saveAs") await onSaveAs(trimmed);
      else if (dialog === "rename" && activeName) await onRename(activeName, trimmed);
      setDialog(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function run(fn: () => Promise<void> | void) {
    try {
      await fn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="max-w-[180px] truncate">
              {activeName ?? "No composition"}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Compositions</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={activeName ?? ""}
            onValueChange={(v) => {
              if (v !== activeName) void run(() => onSwitch(v));
            }}
          >
            {compositions.map((c) => (
              <DropdownMenuRadioItem key={c.name} value={c.name}>
                <span className="truncate">{c.name}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => openDialog("new")}>
            <Plus className="h-3.5 w-3.5" /> New composition…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openDialog("saveAs")}>
            <Copy className="h-3.5 w-3.5" /> Save as…
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => openDialog("rename")}
            disabled={!activeName}
          >
            <Pencil className="h-3.5 w-3.5" /> Rename…
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            disabled={!canDelete}
            onSelect={() => activeName && void run(() => onDelete(activeName))}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {dialog === "new"
                ? "New composition"
                : dialog === "saveAs"
                  ? "Save as new composition"
                  : "Rename composition"}
            </DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !nameError && !busy) void confirm();
            }}
            placeholder="Composition name"
          />
          <div className="h-4 text-xs text-destructive">
            {trimmed.length > 0 ? nameError ?? "" : ""}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void confirm()} disabled={!!nameError || busy}>
              {dialog === "rename" ? "Rename" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
