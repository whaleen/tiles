import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useActionRunner } from "@/hooks/use-action-runner";
import { useCapabilityGating } from "@/hooks/use-providers";
import type { VideoEntry } from "@/types";

interface Props {
  images: VideoEntry[];
  capability: string;
  currentProject?: string;
}

/**
 * Generic AI capability form. Runs through the standard `run_action` pipeline
 * (the `tiles ai` CLI subcommand) so it gets progress, the Outputs page, and
 * batch for free. Hand-coded core fields only; the descriptor-driven advanced
 * block + payload preview land in #8. Currently dry-run — no API key needed.
 */
export function AICapabilityForm({ images, capability, currentProject }: Props) {
  const { runAction, running } = useActionRunner(`ai-${capability}`);
  const { activeProviderId, activeProviderLabel, activeSupports, capabilityFor } =
    useCapabilityGating();
  const cap = capabilityFor(capability);
  const defaultModel = cap?.models.find((m) => m.default)?.id ?? cap?.models[0]?.id;

  const [prompt, setPrompt] = useState("");
  const [strength, setStrength] = useState(0.75);

  const outputFolder = currentProject
    ? `src/${currentProject}/outputs/${capability}`
    : `outputs/${capability}`;

  const supported = activeSupports(capability);
  const targetLabel =
    images.length === 1 ? images[0].name : `${images.length} images`;

  const run = async () => {
    if (!prompt.trim()) {
      toast.error("Enter a prompt");
      return;
    }
    if (images.length === 0) {
      toast.error("No image selected");
      return;
    }
    const res = await runAction({
      action: capability,
      targets: images.map((image) => image.rel_path),
      target_type: "folders_or_videos",
      output_mode: "custom",
      params: {
        output: outputFolder,
        provider: activeProviderId,
        model: defaultModel,
        ai_params: { prompt: prompt.trim(), strength },
      },
    });
    if (res && res.exit_code === 0) {
      toast.success(`Dry-run complete → ${outputFolder}`);
    } else if (res) {
      toast.error("Action failed");
    }
  };

  if (!supported) {
    return (
      <div className="text-xs text-muted-foreground">
        {cap?.label ?? capability} is not supported by the active provider
        {activeProviderLabel ? ` (${activeProviderLabel})` : ""}. Pick a different
        provider in Settings.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" />
        {activeProviderLabel ?? activeProviderId ?? "No provider"}
        {defaultModel ? ` · ${defaultModel}` : ""}
        <span className="text-muted-foreground/70">· {targetLabel}</span>
        <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
          Dry run
        </span>
      </div>

      <div>
        <Label className="text-sm">Prompt</Label>
        <textarea
          className="mt-1 w-full min-h-24 rounded-md border bg-background px-3 py-2 text-sm"
          placeholder="Describe the edit you want to make..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>

      <div>
        <Label className="text-sm">Strength - {strength.toFixed(2)}</Label>
        <p className="text-xs text-muted-foreground mb-1.5">
          How much the prompt overrides the original. Low = subtle edit, high =
          strong transformation.
        </p>
        <Slider
          min={0.1}
          max={1.0}
          step={0.05}
          value={[strength]}
          onValueChange={([value]) => setStrength(value)}
        />
      </div>

      <Button onClick={run} disabled={running} className="w-full">
        {running ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Running...
          </>
        ) : (
          "Run (dry run)"
        )}
      </Button>
    </div>
  );
}
