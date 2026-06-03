import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { KeyRound, Settings } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/errors";

export function SettingsPage() {
  const [modelslabKey, setModelslabKey] = useState("");
  const [savingModelslabKey, setSavingModelslabKey] = useState(false);

  useEffect(() => {
    invoke<string | null>("get_modelslab_key")
      .then((key) => setModelslabKey(key ?? ""))
      .catch(() => setModelslabKey(""));
  }, []);

  const saveModelslabKey = async () => {
    setSavingModelslabKey(true);
    try {
      await invoke("set_modelslab_key", { key: modelslabKey });
      toast.success("ModelsLab API key saved");
    } catch (err) {
      toast.error(errorMessage(err, "Failed to save ModelsLab API key"));
    } finally {
      setSavingModelslabKey(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Settings className="h-4 w-4" />
          Global settings
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          App-wide defaults used across workspaces and projects. Project/workspace overrides can be added later if needed.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" />
            ModelsLab
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="modelslab-key">API key</Label>
            <div className="flex gap-2">
              <Input
                id="modelslab-key"
                type="password"
                value={modelslabKey}
                onChange={(e) => setModelslabKey(e.target.value)}
                placeholder="ModelsLab key"
              />
              <Button onClick={saveModelslabKey} disabled={savingModelslabKey}>
                {savingModelslabKey ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Used as the global default for image actions. Leave blank to clear the saved key.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
