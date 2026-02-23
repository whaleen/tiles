type ActionCapability = {
  allowOutput: boolean;
  allowOverwrite: boolean;
  allowAlongside: boolean;
};

const DEFAULT_CAPS: ActionCapability = {
  allowOutput: true,
  allowOverwrite: true,
  allowAlongside: true,
};

const ACTION_CAPS: Record<string, ActionCapability> = {
  clean: { allowOutput: false, allowOverwrite: false, allowAlongside: false },
  "organize-landscape": {
    allowOutput: false,
    allowOverwrite: false,
    allowAlongside: false,
  },
  concat: { allowOutput: true, allowOverwrite: false, allowAlongside: true },
  detect: { allowOutput: true, allowOverwrite: false, allowAlongside: true },
  "split-detect": { allowOutput: true, allowOverwrite: false, allowAlongside: true },
  transcribe: { allowOutput: true, allowOverwrite: false, allowAlongside: true },
  loop: { allowOutput: true, allowOverwrite: false, allowAlongside: true },
  "yt-import": { allowOutput: true, allowOverwrite: false, allowAlongside: false },
};

export function actionCapabilities(actionName: string | undefined) {
  if (!actionName) return DEFAULT_CAPS;
  return ACTION_CAPS[actionName] ?? DEFAULT_CAPS;
}
