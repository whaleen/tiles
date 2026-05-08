import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useProjects } from "@/hooks/use-projects";
import { errorMessage } from "@/lib/errors";

type CreateProjectDialogProps = {
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onProjectCreated?: (name: string) => void;
};

export function CreateProjectDialog({
  trigger,
  open,
  onOpenChange,
  onProjectCreated,
}: CreateProjectDialogProps) {
  const controlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlled ? open : internalOpen;
  const setOpen = controlled ? onOpenChange ?? (() => undefined) : setInternalOpen;
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const { refresh } = useProjects();

  useEffect(() => {
    if (isOpen) setName("");
  }, [isOpen]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Enter a project name");
      return;
    }

    setCreating(true);
    try {
      const res = await invoke<{ name: string }>("create_project", {
        name: trimmed,
      });
      await refresh();
      setOpen(false);
      toast.success("Project created", { description: res.name });
      onProjectCreated?.(res.name);
    } catch (err) {
      toast.error(errorMessage(err, "Failed to create project"));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Create project</DialogTitle>
            <DialogDescription>
              Create a folder under your workspace&apos;s src directory.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="create-project-name">Project name</Label>
            <Input
              id="create-project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="My Project"
              autoFocus
              disabled={creating}
            />
            <p className="text-xs text-muted-foreground">
              Spaces and unicode are allowed. Path separators are not.
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={creating || !name.trim()}>
              {creating ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
