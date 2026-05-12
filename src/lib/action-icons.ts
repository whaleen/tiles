import {
  LayoutGrid,
  Download,
  Scissors,
  Link,
  ScanLine,
  Columns2,
  VolumeX,
  Sparkles,
  Gauge,
  Wrench,
  MonitorSmartphone,
  Shuffle,
  Play,
  Repeat,
  Clapperboard,
  Crop,
  FileText,
  type LucideIcon,
} from "lucide-react";

const actionIcons: Record<string, LucideIcon> = {
  tile: LayoutGrid,
  "yt-import": Download,
  trim: Scissors,
  concat: Link,
  detect: ScanLine,
  "split-detect": Columns2,
  "strip-audio": VolumeX,
  clean: Sparkles,
  slowmo: Gauge,
  "doctor-reencode": Wrench,
  "organize-landscape": MonitorSmartphone,
  yolo: Shuffle,
  run: Play,
  loop: Repeat,
  chop: Scissors,
  crop: Crop,
  transcribe: FileText,
};

const fallbackIcon: LucideIcon = Clapperboard;

export function getActionIcon(action: string): LucideIcon {
  return actionIcons[action] || fallbackIcon;
}

export function formatActionName(action: string): string {
  return action
    .split(/[-_]/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
