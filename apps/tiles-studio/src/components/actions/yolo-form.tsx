import { ActionFormWrapper } from "./action-form-wrapper";

interface ActionFormProps {
  targetsOverride?: string[];
  targetsSummary?: string;
}

export function YoloForm({ targetsOverride, targetsSummary }: ActionFormProps) {
  return (
    <ActionFormWrapper
      actionName="yolo"
      targetType="settings"
      targetsOverride={targetsOverride}
      targetsSummary={targetsSummary}
      buildRequest={(_targets, outputMode) => ({
        action: "yolo",
        targets: [],
        target_type: "settings",
        output_mode: outputMode,
        params: {},
      })}
    >
      {() => (
        <p className="text-sm text-muted-foreground">
          Picks a random layout and assigns your folders automatically to generate
          a surprise tile composition. No configuration needed — just hit run.
        </p>
      )}
    </ActionFormWrapper>
  );
}
