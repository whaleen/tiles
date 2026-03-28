import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { videoUrl, bumpMediaCache } from "@/api/client";
import { invoke } from "@tauri-apps/api/core";
import { ActionCompleteContext } from "@/contexts/action-complete-context";
import { EditorActionPanel } from "./editor-action-panel";
import { ArrowLeft, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import type { VideoEntry } from "@/types";

interface VideoEditorProps {
  video: VideoEntry;
  videos: VideoEntry[];
  onBack: () => void;
  onRemoveVideo: (relPath: string) => void;
}

export function VideoEditor({
  video,
  videos,
  onBack,
  onRemoveVideo,
}: VideoEditorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoVersion, setVideoVersion] = useState(0);
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [timelineContent, setTimelineContent] = useState<React.ReactNode>(null);
  const [overlayContent, setOverlayContent] = useState<React.ReactNode>(null);

  const isImage = (path: string) =>
    /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(path);
  const activeIsImage = isImage(video.rel_path);

  const currentIndex = videos.findIndex(
    (v) => v.rel_path === video.rel_path
  );

  const goNext = useCallback(() => {
    if (currentIndex >= 0 && currentIndex < videos.length - 1) {
      onNavigate(videos[currentIndex + 1]);
    }
  }, [currentIndex, videos]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      onNavigate(videos[currentIndex - 1]);
    }
  }, [currentIndex, videos]);

  function onNavigate(v: VideoEntry) {
    window.dispatchEvent(
      new CustomEvent("editor-navigate", { detail: v })
    );
  }

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "Escape") onBack();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goNext, goPrev, onBack]);

  // Reset state when video changes
  useEffect(() => {
    setSelectedAction(null);
    setVideoVersion(0);
    setTimelineContent(null);
    setOverlayContent(null);
  }, [video.rel_path]);

  // Clear timeline/overlay when action changes
  useEffect(() => {
    setTimelineContent(null);
    setOverlayContent(null);
    // Reset playbackRate when switching actions
    if (videoRef.current) {
      videoRef.current.playbackRate = 1.0;
    }
  }, [selectedAction]);

  const handleActionComplete = useCallback(() => {
    setVideoVersion((v) => v + 1);
    bumpMediaCache();
  }, []);

  const handleDelete = async () => {
    const ok = window.confirm(`Delete ${video.name}? This cannot be undone.`);
    if (!ok) return;

    // Navigate first (instant), then delete in background
    const nextVideo =
      videos.length <= 1
        ? null
        : currentIndex < videos.length - 1
          ? videos[currentIndex + 1]
          : videos[currentIndex - 1];

    // Optimistically remove from local state — no full API refetch
    onRemoveVideo(video.rel_path);

    if (nextVideo) {
      onNavigate(nextVideo);
    } else {
      onBack();
    }

    // Fire-and-forget the actual deletion
    invoke("delete_video", { path: video.rel_path }).catch(console.error);
  };

  return (
    <ActionCompleteContext.Provider value={handleActionComplete}>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-2 border-b shrink-0">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <span className="text-sm font-medium truncate flex-1">
            {video.folder ? `${video.folder}/${video.name}` : video.name}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="ghost"
              onClick={goPrev}
              disabled={currentIndex <= 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums">
              {currentIndex + 1} / {videos.length}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={goNext}
              disabled={currentIndex >= videos.length - 1}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Main content: two-column layout */}
        <div className="flex-1 min-h-0 grid grid-cols-[1fr_360px]">
          {/* Left: video + timeline */}
          <div className="flex flex-col min-h-0 p-4 gap-3">
            <div className="flex-1 min-h-0 flex items-center justify-center bg-black rounded-lg overflow-hidden relative">
              {activeIsImage ? (
                <img
                  key={`${video.rel_path}-${videoVersion}`}
                  src={videoUrl(video.rel_path)}
                  alt={video.name}
                  className="max-w-full max-h-full object-contain"
                />
              ) : (
                <video
                  ref={videoRef}
                  key={`${video.rel_path}-${videoVersion}`}
                  src={videoUrl(video.rel_path)}
                  controls
                  autoPlay
                  className="max-w-full max-h-full"
                />
              )}
              {/* Overlay slot for crop tool etc. */}
              {overlayContent}
            </div>
            {/* Timeline slot */}
            {timelineContent && (
              <div className="shrink-0">{timelineContent}</div>
            )}
          </div>

          {/* Right: action panel */}
          <div className="border-l p-4 min-h-0 overflow-hidden flex flex-col">
            {activeIsImage ? (
              <div className="text-xs text-muted-foreground">
                Actions are only available for videos.
              </div>
            ) : (
              <EditorActionPanel
                video={video}
                videoRef={videoRef}
                selectedAction={selectedAction}
                onSelectAction={setSelectedAction}
                onRenderTimeline={setTimelineContent}
                onRenderOverlay={setOverlayContent}
              />
            )}
          </div>
        </div>
      </div>
    </ActionCompleteContext.Provider>
  );
}
