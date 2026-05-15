import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type { VideoEntry } from "@/types";

interface Props {
  image: VideoEntry;
  currentProject?: string;
}

export function FluxImg2ImgForm({ image, currentProject }: Props) {
  const [prompt, setPrompt] = useState("");
  const [strength, setStrength] = useState(0.75);
  const [running, setRunning] = useState(false);

  const outputFolder = currentProject
    ? `src/${currentProject}/outputs/flux-img2img`
    : "outputs/flux-img2img";

  const run = async () => {
    if (!prompt.trim()) {
      toast.error("Enter a prompt");
      return;
    }

    setRunning(true);
    try {
      const result = await invoke<{ status: string; output?: string[]; message?: string }>(
        "flux_img2img",
        {
          imageRelPath: image.rel_path,
          prompt: prompt.trim(),
          strength,
          width: 1024,
          height: 1024,
          outputFolder,
        }
      );
      if (result.status === "success") {
        toast.success(`Flux edit saved to ${outputFolder}`);
      } else {
        toast.error(result.message || `Flux returned: ${result.status}`);
      }
    } catch (error) {
      toast.error(String(error));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
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
          How much the prompt overrides the original. Low = subtle edit, high = strong transformation.
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
          "Run Flux Edit"
        )}
      </Button>
    </div>
  );
}
