import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Copy, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ProviderFieldControl } from "@/components/actions/provider-field-control";
import { useActionRunner } from "@/hooks/use-action-runner";
import { useCapabilityGating, type ProviderField } from "@/hooks/use-providers";
import type { VideoEntry } from "@/types";

interface Props {
  images: VideoEntry[];
  capability: string;
  currentProject?: string;
}

const HAND_CODED_CORE = new Set(["prompt", "strength"]);

function defaultFor(field: ProviderField): unknown {
  if (field.default !== undefined && field.default !== null) return field.default;
  if (field.kind === "bool") return false;
  if (field.kind === "number" || field.kind === "slider") return field.min ?? 0;
  return "";
}

/**
 * Hybrid AI capability form (#8):
 *  - generic core (prompt, strength) hand-coded for polish
 *  - provider-specific advanced block rendered from the active provider's
 *    descriptor (so adding a provider/field needs no new form code)
 *  - live payload preview that mirrors the dry-run backend's request, key-free
 *    and with image bytes elided
 * Runs through the standard run_action pipeline. Dry-run until a key exists.
 */
export function AICapabilityForm({ images, capability, currentProject }: Props) {
  const { runAction, running } = useActionRunner(`ai-${capability}`);
  const { activeProviderId, activeProviderLabel, activeSupports, capabilityFor } =
    useCapabilityGating();
  const cap = capabilityFor(capability);
  const defaultModel = cap?.models.find((m) => m.default)?.id ?? cap?.models[0]?.id;

  const fields = useMemo(() => cap?.fields ?? [], [cap]);
  const coreFields = fields.filter((f) => f.group === "core");
  const advancedFields = fields.filter((f) => f.group === "advanced");
  const otherCoreFields = coreFields.filter((f) => !HAND_CODED_CORE.has(f.name));
  const promptField = coreFields.find((f) => f.name === "prompt");
  const strengthField = coreFields.find((f) => f.name === "strength");

  const fieldDefaults = useMemo(() => {
    const init: Record<string, unknown> = {};
    for (const f of fields) init[f.name] = defaultFor(f);
    return init;
  }, [fields]);

  // User edits layered over descriptor defaults. Reset when the capability or
  // active provider changes (their field sets differ).
  const [overrides, setOverrides] = useState<Record<string, unknown>>({});
  useEffect(() => setOverrides({}), [capability, activeProviderId]);
  const values = useMemo(
    () => ({ ...fieldDefaults, ...overrides }),
    [fieldDefaults, overrides]
  );
  const setValue = (name: string, value: unknown) =>
    setOverrides((prev) => ({ ...prev, [name]: value }));

  const outputFolder = currentProject
    ? `src/${currentProject}/outputs/${capability}`
    : `outputs/${capability}`;
  const supported = activeSupports(capability);
  const targetLabel = images.length === 1 ? images[0].name : `${images.length} images`;

  // Params actually sent: descriptor values with blanks dropped.
  const aiParams = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v === null || v === undefined || v === "") continue;
      out[k] = v;
    }
    return out;
  }, [values]);

  // Preview mirrors the dry-run backend payload (commands cli `ai`): key-free,
  // image bytes elided.
  const previewPayload = useMemo(() => {
    const first = images[0];
    const ext = first?.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const stem = first?.name ?? "image";
    return {
      provider: activeProviderId,
      capability,
      model: defaultModel,
      dry_run: true,
      request: {
        ...aiParams,
        model_id: defaultModel,
        init_image: `data:image/${ext};base64,<${stem}>`,
      },
    };
  }, [aiParams, activeProviderId, capability, defaultModel, images]);

  const previewText = JSON.stringify(previewPayload, null, 2);

  const run = async () => {
    const missing = fields.find(
      (f) =>
        f.required &&
        String(values[f.name] ?? "").trim() === ""
    );
    if (missing) {
      toast.error(`Enter ${missing.label.toLowerCase()}`);
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
        ai_params: aiParams,
      },
    });
    if (res && res.exit_code === 0) {
      toast.success(`Dry-run complete → ${outputFolder}`);
    } else if (res) {
      toast.error("Action failed");
    }
  };

  const copyPreview = () => {
    navigator.clipboard
      .writeText(previewText)
      .then(() => toast.success("Payload copied"))
      .catch(() => toast.error("Copy failed"));
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

      {/* Core — hand-coded */}
      {promptField && (
        <div>
          <Label className="text-sm">{promptField.label}</Label>
          <textarea
            className="mt-1 w-full min-h-24 rounded-md border bg-background px-3 py-2 text-sm"
            placeholder={promptField.help ?? "Describe the edit you want to make..."}
            value={String(values.prompt ?? "")}
            onChange={(e) => setValue("prompt", e.target.value)}
          />
        </div>
      )}

      {strengthField && (
        <div>
          <Label className="text-sm">
            {strengthField.label} - {Number(values.strength ?? 0).toFixed(2)}
          </Label>
          {strengthField.help && (
            <p className="text-xs text-muted-foreground mb-1.5">{strengthField.help}</p>
          )}
          <Slider
            min={strengthField.min ?? 0.1}
            max={strengthField.max ?? 1}
            step={strengthField.step ?? 0.05}
            value={[Number(values.strength ?? strengthField.min ?? 0)]}
            onValueChange={([v]) => setValue("strength", v)}
          />
        </div>
      )}

      {otherCoreFields.map((field) => (
        <ProviderFieldControl
          key={field.name}
          field={field}
          value={values[field.name]}
          onChange={setValue}
        />
      ))}

      {/* Advanced — descriptor-driven */}
      {advancedFields.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm">
            <span>Advanced ({advancedFields.length})</span>
            <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-3">
            {advancedFields.map((field) => (
              <ProviderFieldControl
                key={field.name}
                field={field}
                value={values[field.name]}
                onChange={setValue}
              />
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Payload preview */}
      <Collapsible>
        <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm">
          <span>Payload preview</span>
          <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <div className="relative">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1 h-7 px-2"
              onClick={copyPreview}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 text-[11px] leading-relaxed">
              {previewText}
            </pre>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Mirrors the request that would be sent. API key excluded; image bytes
            shown as a placeholder.
          </p>
        </CollapsibleContent>
      </Collapsible>

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
