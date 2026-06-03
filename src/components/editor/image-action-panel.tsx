import { useMemo, useState } from "react";
import { useActions } from "@/hooks/use-actions";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AICapabilityForm } from "@/components/actions/ai-capability-form";
import { actionCapabilities } from "@/components/actions/action-capabilities";
import { useCapabilityGating } from "@/hooks/use-providers";
import type { VideoEntry } from "@/types";

interface ImageActionPanelProps {
  image: VideoEntry;
  currentProject?: string;
}

export function ImageActionPanel({ image, currentProject }: ImageActionPanelProps) {
  const { actions: allActions, loading, error } = useActions();
  const { isCapabilityAction, activeSupports, activeProviderLabel } = useCapabilityGating();
  const [selectedAction, setSelectedAction] = useState<string | null>(null);

  const actions = useMemo(
    () =>
      allActions.filter((action) => {
        const caps = actionCapabilities(action.name);
        return caps.mediaTypes.includes("image") || caps.mediaTypes.includes("any");
      }),
    [allActions]
  );

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex items-center gap-2 shrink-0">
        <Label className="text-sm">Image Action</Label>
        <div className="flex-1">
          {loading && <div className="text-xs text-muted-foreground">Loading...</div>}
          {error && !loading && <div className="text-xs text-destructive">{error}</div>}
          {!loading && !error && actions.length > 0 && (
            <Select value={selectedAction ?? ""} onValueChange={setSelectedAction}>
              <SelectTrigger>
                <SelectValue placeholder="Select an image action" />
              </SelectTrigger>
              <SelectContent>
                {actions.map((action) => {
                  const gated = isCapabilityAction(action.name) && !activeSupports(action.name);
                  return (
                    <SelectItem key={action.name} value={action.name} disabled={gated}>
                      <span className="flex items-center justify-between gap-2">
                        <span>{action.label}</span>
                        {gated && (
                          <span className="text-[10px] text-muted-foreground">
                            {activeProviderLabel
                              ? `Not in ${activeProviderLabel}`
                              : "No provider"}
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          )}
          {!loading && !error && actions.length === 0 && (
            <div className="text-xs text-muted-foreground">No image actions available.</div>
          )}
        </div>
      </div>

      {selectedAction && isCapabilityAction(selectedAction) ? (
        <div className="mt-4">
          <AICapabilityForm
            images={[image]}
            capability={selectedAction}
            currentProject={currentProject}
          />
        </div>
      ) : selectedAction ? (
        <div className="mt-3 text-xs text-muted-foreground">
          No form available for action: {selectedAction}
        </div>
      ) : (
        <div className="mt-3 text-xs text-muted-foreground">
          Choose an image action to configure options.
        </div>
      )}
    </div>
  );
}
