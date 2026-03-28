import { invoke } from "@tauri-apps/api/core";
import { FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface WorkspaceSetupProps {
  onPick: () => void;
  onSet: (path: string) => void;
}

export function WorkspaceSetup({ onPick, onSet }: WorkspaceSetupProps) {
  const [defaultPath, setDefaultPath] = useState<string>("");

  useEffect(() => {
    invoke<string>("default_workspace_path").then(setDefaultPath);
  }, []);

  const useDefault = async () => {
    const path = await invoke<string>("set_workspace", { path: defaultPath });
    onSet(path);
  };

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
            single workspace folder.
          </p>
        </div>
        <div className="w-full flex flex-col gap-3">
          <div className="rounded-md border bg-muted/50 px-3 py-2 text-left">
            <p className="text-xs text-muted-foreground mb-1">Default location</p>
            <p className="text-sm font-mono truncate">{defaultPath}</p>
          </div>
          <Button onClick={useDefault} className="w-full">
            Use this location
          </Button>
          <Button variant="outline" onClick={onPick} className="w-full gap-2">
            <FolderOpen className="h-4 w-4" />
            Choose a different folder
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          If you have an existing tiles workspace, choose that folder instead.
        </p>
      </div>
    </div>
  );
}
