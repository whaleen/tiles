export interface ProjectSummary {
  name: string;
  path: string;
}

export interface ProjectDetail {
  name: string;
  path: string;
  video_count: number;
  subfolders: string[];
}

export interface ProjectMeta {
  display_name?: string | null;
  cover_image_rel?: string | null;
  description?: string | null;
  tags: string[];
}

export interface VideoEntry {
  folder: string;
  name: string;
  rel_path: string;
  duration?: number | null;
  has_transcript?: boolean;
}

export interface VideoInfo {
  duration: number;
  width: number;
  height: number;
}

export interface TileSettingEntry {
  trans_type: string;
  trans_duration: number;
  crop_position: string;
  speed: number;
  mode: string;
  image_duration: number;
  use_landscape: boolean;
  max_duration?: number | null;
}

export interface LayoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type LayoutTreeNode =
  | {
      id: string;
      type: "leaf";
      tileIndex: number;
    }
  | {
      id: string;
      type: "split";
      direction: "row" | "column";
      ratio: number;
      children: [LayoutTreeNode, LayoutTreeNode];
    };

export interface TileSettings {
  layout_code?: string | null;
  crop_mode?: string | null;
  layout_mode?: string | null;
  layout_rects?: LayoutRect[] | null;
  layout_tree?: LayoutTreeNode | null;
  render_mode?: string | null;
  output_mode?: string | null;
  no_overwrite?: boolean | null;
  tile_folders: string[];
  audio_enabled?: boolean | null;
  audio_tiles: number[];
  audio_tile?: number | null;
  max_total_duration?: number | null;
  max_duration?: number | null;
  distribution_mode?: string | null;
  tile_settings: TileSettingEntry[];
  sizing_mode?: string | null;
  canvas_width?: number | null;
  canvas_height?: number | null;
  padding?: number | null;
  bg_color?: string | null;
  no_repeat?: boolean | null;
  output_length_policy?: "shortest" | "longest" | "fixed" | null;
  source_repeat_policy?: "allow" | "no_reuse_per_tile" | "no_reuse_global" | null;
}

export interface LayoutInfo {
  code: string;
  tile_count: number;
}

export interface OutputRun {
  project: string;
  tool: string;
  run_id: string;
  run_rel: string;
  sample_url?: string | null;
  log_file?: string | null;
  modified_epoch: number;
  video_count: number;
}

export interface OutputEntry {
  name: string;
  rel_path: string;
  is_dir: boolean;
  size_bytes: number;
  modified_epoch: number;
  kind: string;
}

export interface ActionInfo {
  name: string;
  label: string;
  description: string;
  target_type: string;
}

export interface ActionRunRequest {
  action: string;
  targets: string[];
  target_type: string;
  output_mode: string;
  params: Record<string, unknown>;
}

export interface ActionRunResult {
  exit_code: number;
  output: string;
  log_file: string;
}

export interface ActionProgress {
  phase: string;
  current?: number | null;
  total?: number | null;
  percent?: number | null;
  message?: string | null;
}

export interface RunningAction {
  id: string;
  action: string;
  output_mode: string;
  output?: string | null;
  project?: string | null;
  started_epoch: number;
  targets: string[];
  progress?: ActionProgress | null;
}

export interface HealthStatus {
  ok: boolean;
  ffmpeg: boolean;
  ffprobe: boolean;
  root: string;
  tiles_bin: string;
}

export interface FolderPathResponse {
  path: string;
}

export interface FolderOrder {
  video_order: string[];
}

export interface MoveVideosResponse {
  moved: number;
  moved_paths: {
    from: string;
    to: string;
  }[];
}
