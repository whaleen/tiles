import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

interface WorkspaceSetupProps {
  onPick: () => void;
}

export function WorkspaceSetup({ onPick }: WorkspaceSetupProps) {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-6 max-w-sm text-center px-4">
        <div className="rounded-full bg-muted p-4">
          <FolderOpen className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">Choose your workspace</h1>
          <p className="text-sm text-muted-foreground">
            tiles stores your projects, source videos, and rendered outputs in a
            single workspace folder. Choose an existing folder or create a new one.
          </p>
        </div>
        <Button onClick={onPick} className="gap-2">
          <FolderOpen className="h-4 w-4" />
          Choose Folder
        </Button>
        <p className="text-xs text-muted-foreground">
          If you have an existing tiles workspace, point tiles to that folder.
        </p>
      </div>
    </div>
  );
}
