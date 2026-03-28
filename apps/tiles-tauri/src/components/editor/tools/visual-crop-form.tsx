import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ActionFormWrapper } from "@/components/actions/action-form-wrapper";
import { CropOverlay } from "./crop-overlay";
import { useVideoInfo } from "@/hooks/use-video-info";
import type { VideoEntry } from "@/types";

interface VisualCropFormProps {
  video: VideoEntry;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  renderOverlay: (node: React.ReactNode) => void;
}

const PRESETS: { label: string; ratio: [number, number] | null }[] = [
  { label: "Free", ratio: null },
  { label: "16:9", ratio: [16, 9] },
  { label: "4:3", ratio: [4, 3] },
  { label: "1:1", ratio: [1, 1] },
  { label: "9:16", ratio: [9, 16] },
];

export function VisualCropForm({
  video,
  videoRef,
  renderOverlay,
}: VisualCropFormProps) {
  const { width, height, loading, error } = useVideoInfo(video.rel_path);
  const [cropX, setCropX] = useState(0);
  const [cropY, setCropY] = useState(0);
  const [cropW, setCropW] = useState(0);
  const [cropH, setCropH] = useState(0);
  const [initialized, setInitialized] = useState(false);

  // Initialize crop to full video
  useEffect(() => {
    if (width && height && !initialized) {
      setCropW(width);
      setCropH(height);
      setCropX(0);
      setCropY(0);
      setInitialized(true);
    }
  }, [width, height, initialized]);

  // Reset on video change
  const [prevPath, setPrevPath] = useState(video.rel_path);
  if (video.rel_path !== prevPath) {
    setPrevPath(video.rel_path);
    setInitialized(false);
    setCropX(0);
    setCropY(0);
    setCropW(0);
    setCropH(0);
  }

  const handleCropChange = (x: number, y: number, w: number, h: number) => {
    setCropX(x);
    setCropY(y);
    setCropW(w);
    setCropH(h);
  };

  const applyPreset = (ratio: [number, number] | null) => {
    if (!width || !height || !ratio) return;
    const [rw, rh] = ratio;
    const targetAspect = rw / rh;
    const videoAspect = width / height;

    let newW: number, newH: number;
    if (targetAspect > videoAspect) {
      newW = width;
      newH = Math.round(width / targetAspect);
    } else {
      newH = height;
      newW = Math.round(height * targetAspect);
    }

    // Ensure even dimensions
    newW = newW - (newW % 2);
    newH = newH - (newH % 2);

    const newX = Math.round((width - newW) / 2);
    const newY = Math.round((height - newH) / 2);
    handleCropChange(newX, newY, newW, newH);
  };

  // Render overlay
  useEffect(() => {
    if (width && height && cropW > 0 && cropH > 0) {
      renderOverlay(
        <CropOverlay
          videoRef={videoRef}
          cropX={cropX}
          cropY={cropY}
          cropW={cropW}
          cropH={cropH}
          videoWidth={width}
          videoHeight={height}
          onCropChange={handleCropChange}
        />
      );
    }
    return () => renderOverlay(null);
  }, [cropX, cropY, cropW, cropH, width, height]);

  return (
    <ActionFormWrapper
      actionName="crop"
      targetType="folders_or_videos"
      targetsOverride={[video.rel_path]}
      targetsSummary={`Video: ${video.name}`}
      buildRequest={(targets, outputMode) => ({
        action: "crop",
        targets,
        target_type: "folders_or_videos",
        output_mode: outputMode,
        params: { x: cropX, y: cropY, w: cropW, h: cropH },
      })}
    >
      {() => (
        <div className="space-y-3">
          {loading && (
            <div className="text-xs text-muted-foreground">
              Loading video info...
            </div>
          )}
          {error && <div className="text-xs text-destructive">{error}</div>}
          {width != null && height != null && (
            <>
              <p className="text-xs text-muted-foreground">
                Drag the crop region on the video, or enter values below.
                Source: {width}x{height}
              </p>

              {/* Presets */}
              <div>
                <Label className="text-xs">Aspect Ratio</Label>
                <div className="flex gap-1 mt-1">
                  {PRESETS.map(({ label, ratio }) => (
                    <Button
                      key={label}
                      size="sm"
                      variant="outline"
                      className="text-xs h-7 px-2"
                      onClick={() => applyPreset(ratio)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">X</Label>
                  <Input
                    type="number"
                    min={0}
                    max={width - 1}
                    value={cropX}
                    onChange={(e) => {
                      const v = parseInt(e.target.value) || 0;
                      setCropX(Math.min(v, width - cropW));
                    }}
                    className="mt-1 h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-xs">Y</Label>
                  <Input
                    type="number"
                    min={0}
                    max={height - 1}
                    value={cropY}
                    onChange={(e) => {
                      const v = parseInt(e.target.value) || 0;
                      setCropY(Math.min(v, height - cropH));
                    }}
                    className="mt-1 h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-xs">Width</Label>
                  <Input
                    type="number"
                    min={16}
                    max={width}
                    value={cropW}
                    onChange={(e) => {
                      const v = parseInt(e.target.value) || 16;
                      setCropW(Math.min(v, width - cropX));
                    }}
                    className="mt-1 h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-xs">Height</Label>
                  <Input
                    type="number"
                    min={16}
                    max={height}
                    value={cropH}
                    onChange={(e) => {
                      const v = parseInt(e.target.value) || 16;
                      setCropH(Math.min(v, height - cropY));
                    }}
                    className="mt-1 h-8 text-xs"
                  />
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </ActionFormWrapper>
  );
}
