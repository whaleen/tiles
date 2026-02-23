import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { videoUrl, apiGet, apiDelete, bumpMediaCache } from "@/api/client";
import type { VideoEntry } from "@/types";
import { createContext, useEffect, useCallback } from "react";
import { useState } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TrimForm } from "@/components/actions/trim-form";
import { DetectForm } from "@/components/actions/detect-form";
import { SplitDetectForm } from "@/components/actions/split-detect-form";
import { StripAudioForm } from "@/components/actions/strip-audio-form";
import { DoctorReencodeForm } from "@/components/actions/doctor-reencode-form";
import { DoctorTrimForm } from "@/components/actions/doctor-trim-form";
import { SlowmoForm } from "@/components/actions/slowmo-form";
import { TranscribeForm } from "@/components/actions/transcribe-form";
import { ChopForm } from "@/components/actions/chop-form";
import { LoopForm } from "@/components/actions/loop-form";
import type { ActionInfo } from "@/types";

export const ActionCompleteContext = createContext<(() => void) | null>(null);

interface VideoPlayerModalProps {
  video: VideoEntry | null;
  videos: VideoEntry[];
  onClose: () => void;
  onNavigate: (video: VideoEntry) => void;
  onDeleted?: () => void;
  onRefresh?: () => void;
}

export function VideoPlayerModal({
  video,
  videos,
  onClose,
  onNavigate,
  onDeleted,
  onRefresh,
}: VideoPlayerModalProps) {
  const [actions, setActions] = useState<ActionInfo[]>([]);
  const [actionsLoading, setActionsLoading] = useState(false);
  const [actionsError, setActionsError] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [videoVersion, setVideoVersion] = useState(0);

  const handleActionComplete = useCallback(() => {
    setVideoVersion((v) => v + 1);
    bumpMediaCache();
  }, []);
  const currentIndex = video
    ? videos.findIndex((v) => v.rel_path === video.rel_path)
    : -1;
  const isImage = (path: string) =>
    /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(path);
  const activeIsImage = video ? isImage(video.rel_path) : false;

  const goNext = useCallback(() => {
    if (currentIndex >= 0 && currentIndex < videos.length - 1) {
      onNavigate(videos[currentIndex + 1]);
    }
  }, [currentIndex, videos, onNavigate]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      onNavigate(videos[currentIndex - 1]);
    }
  }, [currentIndex, videos, onNavigate]);

  useEffect(() => {
    if (!video) return;
    setSelectedAction(null);
    function handleKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [video, goNext, goPrev, onClose]);

  useEffect(() => {
    setActionsLoading(true);
    setActionsError(null);
    apiGet<ActionInfo[]>("/api/actions")
      .then((data) =>
        setActions(
          data.filter(
            (a) =>
              a.target_type !== "settings" &&
              a.target_type !== "url" &&
              a.target_type !== "folders"
          )
        )
      )
      .catch((err) => setActionsError(err.message || "Failed to load actions"))
      .finally(() => setActionsLoading(false));
  }, []);

  const handleDelete = async () => {
    if (!video) return;
    const ok = window.confirm(`Delete ${video.name}? This cannot be undone.`);
    if (!ok) return;
    await apiDelete(`/api/videos/${encodeURIComponent(video.rel_path)}`);
    bumpMediaCache();
    onDeleted?.();
    onRefresh?.();
    onClose();
  };

  const formProps = video
    ? {
        targetsOverride: [video.rel_path],
        targetsSummary: `Video: ${video.name}`,
      }
    : undefined;

  const formMap: Record<string, React.ReactNode> = {
    trim: <TrimForm {...(formProps || {})} />,
    detect: <DetectForm {...(formProps || {})} />,
    "split-detect": <SplitDetectForm {...(formProps || {})} />,
    "strip-audio": <StripAudioForm {...(formProps || {})} />,
    transcribe: <TranscribeForm {...(formProps || {})} />,
    "doctor-reencode": <DoctorReencodeForm {...(formProps || {})} />,
    "doctor-trim-start": <DoctorTrimForm {...(formProps || {})} />,
    slowmo: <SlowmoForm {...(formProps || {})} />,
    chop: <ChopForm {...(formProps || {})} />,
    loop: <LoopForm {...(formProps || {})} />,
  };

  return (
    <Dialog open={!!video} onOpenChange={() => onClose()}>
      <DialogContent className="w-[96vw] max-w-[96vw] lg:max-w-7xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="text-sm truncate">
            {video?.name}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Preview and manage this video.
          </DialogDescription>
        </DialogHeader>
        {video && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] min-h-0 flex-1 overflow-hidden">
            <div className="flex flex-col gap-3 min-h-0">
              <div className="flex-1 min-h-0 flex items-center justify-center">
                {activeIsImage ? (
                  <img
                    key={`${video.rel_path}-${videoVersion}`}
                    src={videoUrl(video.rel_path)}
                    alt={video.name}
                    className="max-w-full max-h-full rounded-md bg-black object-contain"
                  />
                ) : (
                  <video
                    key={`${video.rel_path}-${videoVersion}`}
                    src={videoUrl(video.rel_path)}
                    controls
                    autoPlay
                    className="max-w-full max-h-full rounded-md bg-black"
                  />
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
                <span className="text-xs text-muted-foreground truncate">
                  {video.folder ? `${video.folder}/${video.name}` : video.name}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleDelete}
                  >
                    Delete
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={goPrev}
                    disabled={currentIndex <= 0}
                  >
                    Prev
                  </Button>
                  <span className="text-xs text-muted-foreground self-center">
                    {currentIndex + 1} / {videos.length}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={goNext}
                    disabled={currentIndex >= videos.length - 1}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
            <div className="border rounded-lg p-3 bg-muted/10 flex flex-col min-h-0 overflow-hidden">
              <div className="flex items-center gap-2">
                <Label className="text-sm">Run Action</Label>
                <div className="flex-1">
                  {actionsLoading && (
                    <div className="text-xs text-muted-foreground">Loading actions...</div>
                  )}
                  {actionsError && !actionsLoading && (
                    <div className="text-xs text-destructive">{actionsError}</div>
                  )}
                  {!actionsLoading && !actionsError && actions.length > 0 && !activeIsImage && (
                    <Select
                      value={selectedAction ?? ""}
                      onValueChange={setSelectedAction}
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
              <ActionCompleteContext.Provider value={handleActionComplete}>
                {activeIsImage ? (
                  <div className="mt-3 text-xs text-muted-foreground">
                    Actions are only available for videos.
                  </div>
                ) : selectedAction ? (
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
              </ActionCompleteContext.Provider>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
