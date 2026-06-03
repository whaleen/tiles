import { useEffect, useMemo, useState } from "react";
import { useActions } from "@/hooks/use-actions";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X, Play } from "lucide-react";
import type { VideoEntry } from "@/types";
import { ConcatForm } from "@/components/actions/concat-form";
import { TrimForm } from "@/components/actions/trim-form";
import { DetectForm } from "@/components/actions/detect-form";
import { SplitDetectForm } from "@/components/actions/split-detect-form";
import { StripAudioForm } from "@/components/actions/strip-audio-form";
import { CleanForm } from "@/components/actions/clean-form";
import { SlowmoForm } from "@/components/actions/slowmo-form";
import { OrganizeLandscapeForm } from "@/components/actions/organize-landscape-form";
import { YtImportForm } from "@/components/actions/yt-import-form";
import { TranscribeForm } from "@/components/actions/transcribe-form";
import { ChopForm } from "@/components/actions/chop-form";
import { LoopForm } from "@/components/actions/loop-form";
import { CropForm } from "@/components/actions/crop-form";
import { DoctorReencodeForm } from "@/components/actions/doctor-reencode-form";
import { AICapabilityForm } from "@/components/actions/ai-capability-form";
import { actionCapabilities, actionSupportsMedia } from "@/components/actions/action-capabilities";
import { useCapabilityGating } from "@/hooks/use-providers";

interface LibraryActionPanelProps {
  selectedVideos: VideoEntry[];
  displayedVideos: VideoEntry[];
  currentProject?: string;
}

export function LibraryActionPanel({
  selectedVideos,
  displayedVideos,
  currentProject,
}: LibraryActionPanelProps) {
  const baseVideos = selectedVideos.length > 0 ? selectedVideos : displayedVideos;
  const { actions: allActions, loading, error } = useActions();
  const { isCapabilityAction, activeSupports, activeProviderLabel } = useCapabilityGating();
  const actions = useMemo(
    () => allActions.filter((a) => a.target_type !== "settings"),
    [allActions]
  );
  const [selectedAction, setSelectedAction] = useState<string | null>(null);

  const isImage = (path: string) =>
    /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(path);
  const videoCount = useMemo(
    () => baseVideos.filter((v) => !isImage(v.rel_path)).length,
    [baseVideos]
  );
  const imageCount = useMemo(
    () => baseVideos.filter((v) => isImage(v.rel_path)).length,
    [baseVideos]
  );

  const presentTypes = useMemo(() => {
    const types = new Set<"video" | "image">();
    if (videoCount > 0) types.add("video");
    if (imageCount > 0) types.add("image");
    return types;
  }, [videoCount, imageCount]);

  const selectedActionInfo = useMemo(
    () => actions.find((a) => a.name === selectedAction) || null,
    [actions, selectedAction]
  );

  useEffect(() => {
    if (!selectedAction) return;
    const mediaOk = actionSupportsMedia(selectedAction, presentTypes);
    const providerOk =
      !isCapabilityAction(selectedAction) || activeSupports(selectedAction);
    if (!mediaOk || !providerOk) {
      setSelectedAction(null);
    }
  }, [presentTypes, selectedAction, isCapabilityAction, activeSupports]);

  const firstImage = useMemo(
    () => baseVideos.find((v) => isImage(v.rel_path)) || null,
    [baseVideos]
  );

  const imageVideos = useMemo(
    () => baseVideos.filter((v) => isImage(v.rel_path)),
    [baseVideos]
  );

  const videoTargets = useMemo(
    () => baseVideos.filter((v) => !isImage(v.rel_path)).map((v) => v.rel_path),
    [baseVideos]
  );

  const folderTargets = useMemo(() => {
    const set = new Set<string>();
    for (const v of baseVideos) {
      const folder = v.folder || v.rel_path.split("/").slice(0, -1).join("/");
      if (folder) set.add(folder);
    }
    return Array.from(set).sort();
  }, [baseVideos]);

  const targetsOverride = useMemo(() => {
    if (!selectedActionInfo) return [];
    if (selectedActionInfo.target_type === "url") return [];
    return selectedActionInfo.target_type === "folders"
      ? folderTargets
      : videoTargets;
  }, [selectedActionInfo, folderTargets, videoTargets]);

  const targetsSummary = useMemo(() => {
    if (!selectedActionInfo) return "";
    if (selectedActionInfo.target_type === "url") {
      return currentProject
        ? `Project: ${currentProject}`
        : "Select a project in the sidebar";
    }
    if (isCapabilityAction(selectedActionInfo.name)) {
      return firstImage ? `Image: ${firstImage.name}` : "No image selected";
    }
    const scopeLabel =
      selectedVideos.length > 0 ? "from selection" : "from displayed";
    if (selectedActionInfo.target_type === "folders") {
      return `${folderTargets.length} folder${folderTargets.length !== 1 ? "s" : ""} ${scopeLabel}`;
    }
    return `${videoCount} video${videoCount !== 1 ? "s" : ""} ${scopeLabel}`;
  }, [
    selectedActionInfo,
    folderTargets.length,
    videoCount,
    selectedVideos.length,
    currentProject,
    firstImage,
    isCapabilityAction,
  ]);

  const formProps = {
    targetsOverride,
    targetsSummary,
    onRunComplete: () => setSelectedAction(null),
  };

  const caps = actionCapabilities(selectedAction ?? undefined);

  const formMap: Record<string, React.ReactNode> = {
    concat: <ConcatForm {...formProps} {...caps} />,
    trim: <TrimForm {...formProps} {...caps} />,
    detect: <DetectForm {...formProps} {...caps} />,
    "split-detect": <SplitDetectForm {...formProps} {...caps} />,
    "strip-audio": <StripAudioForm {...formProps} {...caps} />,
    transcribe: <TranscribeForm {...formProps} {...caps} />,
    clean: <CleanForm {...formProps} {...caps} />,
    slowmo: <SlowmoForm {...formProps} {...caps} />,
    "organize-landscape": <OrganizeLandscapeForm {...formProps} {...caps} />,
    chop: <ChopForm {...formProps} {...caps} />,
    loop: <LoopForm {...formProps} {...caps} />,
    crop: <CropForm {...formProps} {...caps} />,
    "doctor-reencode": <DoctorReencodeForm {...formProps} {...caps} />,
    "yt-import": (
        <YtImportForm
          {...formProps}
          {...caps}
          currentProject={currentProject}
        />
      ),
    "image-edit": imageVideos.length > 0 ? (
      <AICapabilityForm
        images={imageVideos}
        capability="image-edit"
        currentProject={currentProject}
      />
    ) : null,
  };

  return (
    <div className="border rounded-lg p-3 bg-muted/20">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium flex items-center gap-1.5">
          <Play className="h-3.5 w-3.5" />
          Run Action
        </span>
        <div className="flex-1">
          {loading && (
            <div className="text-xs text-muted-foreground">Loading actions...</div>
          )}
          {error && !loading && (
            <div className="text-xs text-destructive">{error}</div>
          )}
          {!loading && !error && actions.length === 0 && (
            <div className="text-xs text-muted-foreground">
              No actions available.
            </div>
          )}
          {!loading && !error && actions.length > 0 && (
            <div className="flex items-center gap-2">
              <Select value={selectedAction ?? ""} onValueChange={setSelectedAction}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an action" />
                </SelectTrigger>
                <SelectContent>
                  {actions.map((action) => {
                    const mediaOk = actionSupportsMedia(action.name, presentTypes);
                    const providerOk =
                      !isCapabilityAction(action.name) || activeSupports(action.name);
                    const supported = mediaOk && providerOk;
                    const caps = actionCapabilities(action.name);
                    const reason = !mediaOk
                      ? caps.mediaTypes.includes("video") && !caps.mediaTypes.includes("image")
                        ? "Requires video"
                        : caps.mediaTypes.includes("image") && !caps.mediaTypes.includes("video")
                          ? "Requires image"
                          : "Not compatible"
                      : activeProviderLabel
                        ? `Not in ${activeProviderLabel}`
                        : "No provider";
                    return (
                      <SelectItem key={action.name} value={action.name} disabled={!supported}>
                        <span className="flex items-center justify-between gap-2">
                          <span>{action.label}</span>
                          {!supported && <span className="text-[10px] text-muted-foreground">{reason}</span>}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {selectedAction && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedAction(null)}
                >
                  <X className="h-3.5 w-3.5" />
                  Close
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {selectedAction && (
        <p className="mt-2 text-xs text-muted-foreground">
          Scope: {videoCount} video{videoCount !== 1 ? "s" : ""}, {imageCount} image{imageCount !== 1 ? "s" : ""}.
        </p>
      )}

      {selectedAction && (
        <div className="mt-4">
          {formMap[selectedAction] || (
            <div className="text-xs text-muted-foreground">
              No form available for action: {selectedAction}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
