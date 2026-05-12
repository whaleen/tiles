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
  const [format, setFormat] = useState("txt");

  return (
    <ActionFormWrapper
      actionName="transcribe"
      targetType="folders_or_videos"
      targetsOverride={targetsOverride}
      targetsSummary={targetsSummary}
      onRunComplete={onRunComplete}
      allowOutput={false}
      allowOverwrite={allowOverwrite}
      allowAlongside={allowAlongside}
      fixedOutputMode="alongside"
      buildRequest={(targets, outputMode) => ({
        action: "transcribe",
        targets,
        target_type: "folders_or_videos",
        output_mode: outputMode,
        params: {
          language: language.trim() || "auto",
          format,
        },
      })}
    >
      {() => (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Transcribes audio from videos using whisper-cli and saves the transcript
            next to the source video. Requires{" "}
            <code className="text-xs">brew install whisper-cpp</code>.
          </p>
          <div>
            <Label className="text-sm">Language</Label>
            <Input
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              placeholder="auto"
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Use a language code (e.g. <code>en</code>, <code>es</code>) or{" "}
              <code>auto</code> to detect.
            </p>
          </div>
          <div>
            <Label className="text-sm">Output Format</Label>
            <Select value={format} onValueChange={setFormat}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="txt">Text (.txt)</SelectItem>
                <SelectItem value="srt">SRT subtitles (.srt)</SelectItem>
                <SelectItem value="vtt">WebVTT (.vtt)</SelectItem>
                <SelectItem value="json">JSON (.json)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </ActionFormWrapper>
  );
}
