import { useState } from "react";
import { ActionFormWrapper } from "./action-form-wrapper";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

interface ActionFormProps {
  targetsOverride?: string[];
  targetsSummary?: string;
  allowOutput?: boolean;
  allowOverwrite?: boolean;
  allowAlongside?: boolean;
  onRunComplete?: () => void;
}

export function TranscribeForm({
  targetsOverride,
  targetsSummary,
  allowOutput,
  allowOverwrite,
  allowAlongside,
  onRunComplete,
}: ActionFormProps) {
  const [language, setLanguage] = useState("auto");
  const [format, setFormat] = useState("text");
  const [queue, setQueue] = useState("3");
  const [useGpu, setUseGpu] = useState(true);
  const [gpuDevice, setGpuDevice] = useState("0");
  const queueValue = parseFloat(queue);
  const gpuDeviceValue = parseInt(gpuDevice, 10);

  return (
    <ActionFormWrapper
      actionName="transcribe"
      targetType="folders_or_videos"
      targetsOverride={targetsOverride}
      targetsSummary={targetsSummary}
      onRunComplete={onRunComplete}
      allowOutput={allowOutput}
      allowOverwrite={allowOverwrite}
      allowAlongside={allowAlongside}
      buildRequest={(targets, outputMode) => ({
        action: "transcribe",
        targets,
        target_type: "folders_or_videos",
        output_mode: outputMode,
        params: {
          language: language.trim() || "auto",
          format,
          queue: Number.isFinite(queueValue) ? queueValue : undefined,
          use_gpu: useGpu,
          gpu_device: Number.isFinite(gpuDeviceValue) ? gpuDeviceValue : undefined,
        },
      })}
    >
      {() => (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Uses FFmpeg's whisper filter to generate transcripts. Requires FFmpeg
            built with whisper.cpp support and a local Whisper model file.
          </p>
          <div className="text-xs text-muted-foreground">
            Model: ggml-base.bin (auto-downloaded to models/ on first run)
          </div>
          <div>
            <Label className="text-sm">Language</Label>
            <Input
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              placeholder="auto"
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-sm">Output Format</Label>
            <Select value={format} onValueChange={setFormat}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="srt">SRT</SelectItem>
                <SelectItem value="json">JSON</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm">Queue (seconds)</Label>
            <Input
              type="number"
              step="0.1"
              min="0"
              value={queue}
              onChange={(e) => setQueue(e.target.value)}
              className="mt-1"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={useGpu} onCheckedChange={setUseGpu} />
            <Label className="text-sm">Use GPU</Label>
          </div>
          <div>
            <Label className="text-sm">GPU Device</Label>
            <Input
              type="number"
              min="0"
              step="1"
              value={gpuDevice}
              onChange={(e) => setGpuDevice(e.target.value)}
              className="mt-1"
              disabled={!useGpu}
            />
          </div>
        </div>
      )}
    </ActionFormWrapper>
  );
}
