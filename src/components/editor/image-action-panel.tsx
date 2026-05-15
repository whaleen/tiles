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
import { FluxImg2ImgForm } from "@/components/actions/flux-img2img-form";
import { actionCapabilities } from "@/components/actions/action-capabilities";
import type { VideoEntry } from "@/types";

interface ImageActionPanelProps {
  image: VideoEntry;
  currentProject?: string;
}

export function ImageActionPanel({ image, currentProject }: ImageActionPanelProps) {
  const { actions: allActions, loading, error } = useActions();
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
                {actions.map((action) => (
                  <SelectItem key={action.name} value={action.name}>
                    {action.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {!loading && !error && actions.length === 0 && (
            <div className="text-xs text-muted-foreground">No image actions available.</div>
          )}
        </div>
      </div>

      {selectedAction === "flux-img2img" ? (
        <div className="mt-4">
          <FluxImg2ImgForm image={image} currentProject={currentProject} />
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
