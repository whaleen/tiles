import { useEffect, useMemo } from "react";
import { useActions } from "@/hooks/use-actions";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DetectForm } from "@/components/actions/detect-form";
import { SplitDetectForm } from "@/components/actions/split-detect-form";
import { StripAudioForm } from "@/components/actions/strip-audio-form";
import { DoctorReencodeForm } from "@/components/actions/doctor-reencode-form";
import { DoctorTrimForm } from "@/components/actions/doctor-trim-form";
import { TranscribeForm } from "@/components/actions/transcribe-form";
import { ChopForm } from "@/components/actions/chop-form";
import { VisualTrimForm } from "./tools/visual-trim-form";
import { VisualCropForm } from "./tools/visual-crop-form";
import { VisualLoopForm } from "./tools/visual-loop-form";
import { VisualSlowmoForm } from "./tools/visual-slowmo-form";
import type { VideoEntry } from "@/types";

interface EditorActionPanelProps {
  video: VideoEntry;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  selectedAction: string | null;
  onSelectAction: (action: string | null) => void;
  onRenderTimeline: (node: React.ReactNode) => void;
  onRenderOverlay: (node: React.ReactNode) => void;
}

export function EditorActionPanel({
  video,
  videoRef,
  selectedAction,
  onSelectAction,
  onRenderTimeline,
  onRenderOverlay,
}: EditorActionPanelProps) {
  const { actions: allActions, loading, error } = useActions();
  const actions = useMemo(
    () =>
      allActions.filter(
        (a) =>
          a.target_type !== "settings" &&
          a.target_type !== "url" &&
          a.target_type !== "folders"
      ),
    [allActions]
  );

  // Clear timeline/overlay when there's no visual tool
  useEffect(() => {
    const visualActions = ["trim", "crop", "loop", "slowmo"];
    if (!selectedAction || !visualActions.includes(selectedAction)) {
      onRenderTimeline(null);
      onRenderOverlay(null);
    }
  }, [selectedAction, onRenderTimeline, onRenderOverlay]);

  const formProps = useMemo(
    () => ({
      targetsOverride: [video.rel_path],
      targetsSummary: `Video: ${video.name}`,
    }),
    [video.rel_path, video.name]
  );

  const formMap: Record<string, React.ReactNode> = {
    trim: (
      <VisualTrimForm
        video={video}
        videoRef={videoRef}
        renderTimeline={onRenderTimeline}
      />
    ),
    crop: (
      <VisualCropForm
        video={video}
        videoRef={videoRef}
        renderOverlay={onRenderOverlay}
      />
    ),
    detect: <DetectForm {...formProps} />,
    "split-detect": <SplitDetectForm {...formProps} />,
    "strip-audio": <StripAudioForm {...formProps} />,
    transcribe: <TranscribeForm {...formProps} />,
    "doctor-reencode": <DoctorReencodeForm {...formProps} />,
    "doctor-trim-start": <DoctorTrimForm {...formProps} />,
    slowmo: <VisualSlowmoForm video={video} videoRef={videoRef} />,
    chop: <ChopForm {...formProps} />,
    loop: (
      <VisualLoopForm
        video={video}
        videoRef={videoRef}
        renderOverlay={onRenderOverlay}
      />
    ),
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex items-center gap-2 shrink-0">
        <Label className="text-sm">Action</Label>
        <div className="flex-1">
          {loading && (
            <div className="text-xs text-muted-foreground">Loading...</div>
          )}
          {error && !loading && (
            <div className="text-xs text-destructive">{error}</div>
          )}
          {!loading && !error && actions.length > 0 && (
            <Select
              value={selectedAction ?? ""}
              onValueChange={onSelectAction}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select an action" />
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
        </div>
      </div>

      {selectedAction ? (
        <div className="mt-3 min-h-0 flex-1">
          <ScrollArea className="h-full pr-2">
            {formMap[selectedAction] || (
              <div className="text-xs text-muted-foreground">
                No form available for action: {selectedAction}
              </div>
            )}
          </ScrollArea>
        </div>
      ) : (
        <div className="mt-3 text-xs text-muted-foreground">
          Choose an action to configure options.
        </div>
      )}
    </div>
  );
}
