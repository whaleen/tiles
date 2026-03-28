import { ActionFormWrapper } from "./action-form-wrapper";

interface ActionFormProps {
  targetsOverride?: string[];
  targetsSummary?: string;
  allowOutput?: boolean;
  allowOverwrite?: boolean;
  allowAlongside?: boolean;
  onRunComplete?: () => void;
}

export function OrganizeLandscapeForm({
  targetsOverride,
  targetsSummary,
  allowOutput,
  allowOverwrite,
  allowAlongside,
  onRunComplete,
}: ActionFormProps) {
  return (
    <ActionFormWrapper
      actionName="organize-landscape"
      targetType="folders"
      targetsOverride={targetsOverride}
      targetsSummary={targetsSummary}
      onRunComplete={onRunComplete}
      allowOutput={allowOutput}
      allowOverwrite={allowOverwrite}
      allowAlongside={allowAlongside}
      buildRequest={(targets, outputMode) => ({
        action: "organize-landscape",
        targets,
        target_type: "folders",
        output_mode: outputMode,
        params: {},
      })}
    >
      {() => (
        <p className="text-sm text-muted-foreground">
          Moves videos into landscape/ and portrait/ subfolders based on their
          aspect ratio. Helpful for separating phone footage (portrait) from
          camera footage (landscape) before tiling.
        </p>
      )}
    </ActionFormWrapper>
  );
}
