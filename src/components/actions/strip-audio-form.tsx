import { ActionFormWrapper } from "./action-form-wrapper";

interface ActionFormProps {
  targetsOverride?: string[];
  targetsSummary?: string;
  allowOutput?: boolean;
  allowOverwrite?: boolean;
  allowAlongside?: boolean;
  onRunComplete?: () => void;
}

export function StripAudioForm({
  targetsOverride,
  targetsSummary,
  allowOutput,
  allowOverwrite,
  allowAlongside,
  onRunComplete,
}: ActionFormProps) {
  return (
    <ActionFormWrapper
      actionName="strip-audio"
      targetType="folders_or_videos"
      targetsOverride={targetsOverride}
      targetsSummary={targetsSummary}
      allowOutput={allowOutput}
      allowOverwrite={allowOverwrite}
      allowAlongside={allowAlongside}
      onRunComplete={onRunComplete}
      buildRequest={(targets, outputMode) => ({
        action: "strip-audio",
        targets,
        target_type: "folders_or_videos",
        output_mode: outputMode,
        params: {},
      })}
    >
      {() => (
        <p className="text-sm text-muted-foreground">
          Strips the audio track from each video, producing silent video files.
          The video quality is preserved — only the audio is removed.
        </p>
      )}
    </ActionFormWrapper>
  );
}
