type MediaType = "video" | "image" | "any";

export type ActionCapability = {
  allowOutput: boolean;
  allowOverwrite: boolean;
  allowAlongside: boolean;
  mediaTypes: MediaType[];
};

const DEFAULT_CAPS: ActionCapability = {
  allowOutput: true,
  allowOverwrite: true,
  allowAlongside: true,
  mediaTypes: ["video"],
};

const ACTION_CAPS: Record<string, ActionCapability> = {
  clean: { allowOutput: false, allowOverwrite: false, allowAlongside: false, mediaTypes: ["any"] },
  "organize-landscape": {
    allowOutput: false,
    allowOverwrite: false,
    allowAlongside: false,
    mediaTypes: ["video"],
  },
  concat: { allowOutput: true, allowOverwrite: false, allowAlongside: true, mediaTypes: ["video"] },
  trim: { allowOutput: true, allowOverwrite: false, allowAlongside: true, mediaTypes: ["video"] },
  detect: { allowOutput: true, allowOverwrite: false, allowAlongside: true, mediaTypes: ["video"] },
  "split-detect": { allowOutput: true, allowOverwrite: false, allowAlongside: true, mediaTypes: ["video"] },
  "strip-audio": { allowOutput: true, allowOverwrite: false, allowAlongside: true, mediaTypes: ["video"] },
  transcribe: { allowOutput: false, allowOverwrite: false, allowAlongside: false, mediaTypes: ["video"] },
  chop: { allowOutput: true, allowOverwrite: false, allowAlongside: true, mediaTypes: ["video"] },
  slowmo: { allowOutput: true, allowOverwrite: false, allowAlongside: true, mediaTypes: ["video"] },
  loop: { allowOutput: true, allowOverwrite: false, allowAlongside: true, mediaTypes: ["video"] },
  "yt-import": { allowOutput: true, allowOverwrite: false, allowAlongside: false, mediaTypes: ["any"] },
  crop: { allowOutput: true, allowOverwrite: true, allowAlongside: true, mediaTypes: ["video"] },
  "doctor-reencode": { allowOutput: true, allowOverwrite: true, allowAlongside: true, mediaTypes: ["video"] },
  tile: { allowOutput: true, allowOverwrite: false, allowAlongside: true, mediaTypes: ["any"] },
  run: { allowOutput: true, allowOverwrite: false, allowAlongside: true, mediaTypes: ["any"] },
  yolo: { allowOutput: true, allowOverwrite: false, allowAlongside: true, mediaTypes: ["any"] },
  "flux-img2img": { allowOutput: true, allowOverwrite: false, allowAlongside: true, mediaTypes: ["image"] },
};

export function actionCapabilities(actionName: string | undefined) {
  if (!actionName) return DEFAULT_CAPS;
  return ACTION_CAPS[actionName] ?? DEFAULT_CAPS;
}

export function actionSupportsMedia(
  actionName: string | undefined,
  presentTypes: Set<"video" | "image">
): boolean {
  const caps = actionCapabilities(actionName);
  if (caps.mediaTypes.includes("any")) return true;
  return [...presentTypes].every((type) => caps.mediaTypes.includes(type));
}
