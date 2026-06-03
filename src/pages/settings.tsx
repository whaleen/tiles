import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Settings, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveProvider } from "@/hooks/use-providers";
import { errorMessage } from "@/lib/errors";

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { providers, activeId } = useActiveProvider();
  const [modelslabKey, setModelslabKey] = useState("");
  const [savingModelslabKey, setSavingModelslabKey] = useState(false);

  useEffect(() => {
    invoke<string | null>("get_modelslab_key")
      .then((key) => setModelslabKey(key ?? ""))
      .catch(() => setModelslabKey(""));
  }, []);

  const selectActiveProvider = async (provider: string) => {
    try {
      await invoke("set_active_provider", { provider });
      queryClient.invalidateQueries({ queryKey: ["active-provider"] });
      toast.success("Active provider updated");
    } catch (err) {
      toast.error(errorMessage(err, "Failed to set active provider"));
    }
  };

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
            <Sparkles className="h-4 w-4" />
            AI provider
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label>Active provider</Label>
            <Select value={activeId ?? ""} onValueChange={selectActiveProvider}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a provider" />
              </SelectTrigger>
              <SelectContent>
                {providers.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            One provider is active at a time. AI actions are enabled only for
            capabilities the active provider supports.
          </p>
        </CardContent>
      </Card>

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
