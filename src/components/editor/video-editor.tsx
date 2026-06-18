import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { readFullscreenState, useFullscreenVideo } from "@/components/fullscreen-video-player";
import { videoUrl, bumpMediaCache } from "@/api/client";
import { invoke } from "@tauri-apps/api/core";
import { ActionCompleteContext } from "@/contexts/action-complete-context";
import { queryClient } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";
import { errorMessage } from "@/lib/errors";
import { toast } from "sonner";
import { EditorActionPanel } from "./editor-action-panel";
import { ImageActionPanel } from "./image-action-panel";
import { ArrowLeft, ChevronLeft, ChevronRight, Maximize, Trash2 } from "lucide-react";
import { parseTranscript, isSeekableFormat } from "@/lib/transcript";
import { TranscriptViewer } from "./transcript-viewer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { VideoEntry } from "@/types";

interface VideoEditorProps {
  video: VideoEntry;
  videos: VideoEntry[];
  currentProject?: string;
  onBack: () => void;
  onRemoveVideo: (relPath: string) => void;
}

export function VideoEditor({
  video,
  videos,
  currentProject,
  onBack,
  onRemoveVideo,
}: VideoEditorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoVersion, setVideoVersion] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [timelineContent, setTimelineContent] = useState<React.ReactNode>(null);
  const [overlayContent, setOverlayContent] = useState<React.ReactNode>(null);
  const { openVideoFullscreen, isVideoFullscreenOpen } = useFullscreenVideo();
  const isImage = (path: string) =>
    /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(path);
  const activeIsImage = isImage(video.rel_path);

  const enterFullscreen = useCallback(() => {
    if (activeIsImage) return;
    openVideoFullscreen({
      src: videoUrl(video.rel_path),
      title: video.name,
      ...readFullscreenState(videoRef.current),
      onClose: (state) => {
        const el = videoRef.current;
        if (!el) return;
        el.currentTime = state.currentTime;
        el.volume = state.volume;
        el.muted = state.muted;
        el.playbackRate = state.playbackRate;
        if (state.paused) el.pause();
        else void el.play().catch(() => {});
      },
    });
  }, [activeIsImage, openVideoFullscreen, video.name, video.rel_path]);

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
      if (isVideoFullscreenOpen) return;
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "Escape") onBack();
      if (e.key === "f" || e.key === "F") enterFullscreen();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goNext, goPrev, onBack, enterFullscreen, isVideoFullscreenOpen]);

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

  const { data: transcriptDoc } = useQuery({
    queryKey: ["transcript-doc", video.rel_path],
    queryFn: () =>
      invoke<{ format: string; content: string } | null>("get_transcript_doc", {
        path: video.rel_path,
      }),
    enabled: !activeIsImage,
    staleTime: 30_000,
  });

  const transcriptSegments = useMemo(
    () => (transcriptDoc ? parseTranscript(transcriptDoc.format, transcriptDoc.content) : []),
    [transcriptDoc]
  );

  // Seek the player to a transcript segment start (display-only; no edits).
  const handleTranscriptSeek = useCallback((seconds: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = seconds;
    void v.play().catch(() => {});
  }, []);

  const handleActionComplete = useCallback(() => {
    setVideoVersion((v) => v + 1);
    bumpMediaCache();
    queryClient.invalidateQueries({ queryKey: ["transcript-doc", video.rel_path] });
  }, [video.rel_path]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await invoke("delete_video", { path: video.rel_path });
      const nextVideo =
        videos.length <= 1
          ? null
          : currentIndex < videos.length - 1
            ? videos[currentIndex + 1]
            : videos[currentIndex - 1];

      onRemoveVideo(video.rel_path);
      queryClient.invalidateQueries({ queryKey: queryKeys.videos.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
      toast.success("Video deleted", { description: video.name });

      if (nextVideo) {
        onNavigate(nextVideo);
      } else {
        onBack();
      }
    } catch (err) {
      toast.error(errorMessage(err, "Failed to delete video"));
    } finally {
      setDeleting(false);
    }
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
              variant="ghost"
              onClick={enterFullscreen}
              title="Fullscreen (F)"
            >
              <Maximize className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setConfirmDelete(true)}
              disabled={deleting}
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

          {/* Right: action panel + transcript */}
          <div className="border-l min-h-0 overflow-y-auto flex flex-col">
            <div className="p-4">
              {activeIsImage ? (
                <ImageActionPanel image={video} currentProject={currentProject} />
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
            {transcriptSegments.length > 0 && (
              <div className="border-t p-4 shrink-0">
                <TranscriptViewer
                  segments={transcriptSegments}
                  seekable={!!transcriptDoc && isSeekableFormat(transcriptDoc.format)}
                  onSeek={handleTranscriptSeek}
                />
              </div>
            )}
          </div>
        </div>
      </div>
      <Dialog open={confirmDelete} onOpenChange={(open) => { if (!deleting) setConfirmDelete(open); }}>
        <DialogContent>
          <form onSubmit={(e) => { e.preventDefault(); void handleDelete(); }}>
            <DialogHeader>
              <DialogTitle>Delete file?</DialogTitle>
              <DialogDescription>
                "{video.name}" will be permanently deleted. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={deleting}>
                {deleting ? "Deleting..." : "Delete"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </ActionCompleteContext.Provider>
  );
}
