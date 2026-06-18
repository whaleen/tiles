import React, { useState, useRef, useEffect, type ReactNode } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Input } from "@/components/ui/input";
import {
  Crop,
  Film,
  Gauge,
  Monitor,
  Rows2,
  SplitSquareHorizontal,
  SplitSquareVertical,
  Timer,
  Trash2,
  Volume2,
  VolumeOff,
  Image,
  EyeOff,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuGroup,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Switch } from "@/components/ui/switch";
import { layoutGrids, buildGrid } from "./layout-grids";
import type { TileSettingEntry } from "@/types";

// Approximate platform safe-zone margins (% of the canvas frame) where on-screen
// UI sits. Preview/layout guidance only — these never affect render/export.
const SAFE_ZONES: Record<
  string,
  { top: number; bottom: number; left: number; right: number; label: string }
> = {
  "youtube-shorts": { top: 7, bottom: 17, left: 4, right: 12, label: "YouTube Shorts" },
  tiktok: { top: 7, bottom: 18, left: 4, right: 14, label: "TikTok" },
  "instagram-reels": { top: 8, bottom: 20, left: 4, right: 14, label: "Reels" },
};

/** Preview-only overlay showing a platform's safe area. pointer-events-none. */
function SafeZoneOverlay({ type }: { type?: string | null }) {
  const z = type ? SAFE_ZONES[type] : undefined;
  if (!z) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <div className="absolute inset-x-0 top-0 bg-black/30" style={{ height: `${z.top}%` }} />
      <div className="absolute inset-x-0 bottom-0 bg-black/30" style={{ height: `${z.bottom}%` }} />
      <div className="absolute inset-y-0 left-0 bg-black/30" style={{ width: `${z.left}%` }} />
      <div className="absolute inset-y-0 right-0 bg-black/30" style={{ width: `${z.right}%` }} />
      <div
        className="absolute border border-dashed border-yellow-300/80"
        style={{ top: `${z.top}%`, bottom: `${z.bottom}%`, left: `${z.left}%`, right: `${z.right}%` }}
      />
      <div className="absolute left-1 top-1 rounded bg-black/60 px-1 py-0.5 text-[9px] font-medium text-yellow-200">
        {z.label} safe area
      </div>
    </div>
  );
}

export type TilePlayback = {
  src: string;
  /** The clip's start in timeline seconds. */
  clipStart: number;
  /** The clip's trim-in/source start in media seconds. */
  sourceStart: number;
  /** Exact source time for the current playhead, used for manual scrubbing. */
  sourceTime: number;
  /** Server-rendered frame for reliable paused/scrub preview. */
  frameSrc: string;
  rate: number;
  poster?: string;
  /** Filmstrip sprite for instant scrub (cell blit instead of a video seek). */
  filmstrip?: {
    url: string;
    frameCount: number;
    columns: number;
    frameWidth: number;
    frameHeight: number;
    duration: number;
  };
};

interface TileGridPreviewProps {
  layoutCode: string;
  tileCount: number;
  folders: string[];
  folderThumbs?: Record<string, string>;
  tileThumbs?: Record<number, string | null>;
  /** Per-tile live video for playback/scrub. null = blank region; absent = fall back to thumb. */
  tileVideos?: Record<number, TilePlayback | null>;
  playing?: boolean;
  /** Live playhead (seconds), read imperatively so playback doesn't re-render. */
  playheadRef?: React.MutableRefObject<number>;
  cropMode?: string | null;
  tileSettings?: TileSettingEntry[];
  onPickTile?: (index: number) => void;
  layoutTree?: LayoutNode | null;
  onSplit?: (tileIndex: number, direction: "row" | "column", place: "before" | "after") => void;
  onResizeSplit?: (nodeId: string, ratio: number) => void;
  onRemoveTile?: (tileIndex: number) => void;
  onSetCropPosition?: (tileIndex: number, position: string) => void;
  selectedTileIndex?: number | null;
  onUpdateTileSetting?: (tileIndex: number, partial: Partial<TileSettingEntry>) => void;
  onToggleTileAudio?: (tileIndex: number, enabled: boolean) => void;
  audioTiles?: number[];
  /** Preview-only: tiles hidden while editing (not persisted, doesn't affect export). */
  hiddenTiles?: Set<number>;
  /** Preview-only safe-zone guide overlay (does not affect render). */
  showSafeZones?: boolean;
  safeZoneType?: string | null;
  /** Editor chrome: render per-tile info/footer labels. Default true. */
  showTileInfo?: boolean;
  canvasWidth?: number;
  canvasHeight?: number;
  padding?: number;
  bgColor?: string;
}


function parseNumber(value: string) {
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function CustomNumberInput({
  value,
  placeholder,
  onCommit,
}: {
  value: string;
  placeholder?: string;
  onCommit: (value: string) => void;
}) {
  return (
    <div className="px-2 pb-2">
      <div className="text-xs text-muted-foreground mb-1">Custom</div>
      <Input
        defaultValue={value}
        className="h-7 text-xs"
        placeholder={placeholder}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          onCommit(event.currentTarget.value);
        }}
      />
    </div>
  );
}

const CROP_POSITIONS = [
  "top-left",    "top",    "top-right",
  "left",        "center", "right",
  "bottom-left", "bottom", "bottom-right",
];

function cropPositionIndex(position: string) {
  const idx = CROP_POSITIONS.indexOf(position);
  return idx >= 0 ? idx : 4;
}

function cellFromMouse(e: React.MouseEvent<HTMLElement>) {
  const rect = e.currentTarget.getBoundingClientRect();
  const col = Math.min(2, Math.floor(((e.clientX - rect.left) / rect.width) * 3));
  const row = Math.min(2, Math.floor(((e.clientY - rect.top) / rect.height) * 3));
  return row * 3 + col;
}

function CropPinOverlay({
  cropPosition,
  active,
  hoveredCell,
}: {
  cropPosition: string;
  active?: boolean;
  hoveredCell?: number | null;
}) {
  const highlight = cropPositionIndex(cropPosition);
  return (
    <div
      className={`absolute inset-0 pointer-events-none transition-opacity ${
        active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
      }`}
    >
      <div className="grid grid-cols-3 grid-rows-3 w-full h-full">
        {Array.from({ length: 9 }, (_, i) => (
          <div
            key={i}
            className={`border border-white/15 transition-colors ${
              i === highlight
                ? "bg-white/25"
                : hoveredCell === i
                  ? "bg-white/15"
                  : ""
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function TileFooter({
  folder,
  tileIndex,
  setting,
  hasAudio,
}: {
  folder: string | undefined;
  tileIndex: number;
  setting: TileSettingEntry;
  hasAudio: boolean;
}) {
  const icons: { icon: React.ElementType; title: string }[] = [];

  if (hasAudio) icons.push({ icon: Volume2, title: "Audio enabled" });
  else icons.push({ icon: VolumeOff, title: "Audio muted" });

  if (setting.speed !== 1.0) icons.push({ icon: Gauge, title: `Speed ${setting.speed}x` });
  if (setting.crop_position !== "center") icons.push({ icon: Crop, title: `Crop: ${setting.crop_position}` });
  if (setting.trans_type !== "none") icons.push({ icon: Rows2, title: `Transition: ${setting.trans_type}` });
  if (setting.mode === "image") icons.push({ icon: Image, title: "Image mode" });
  if (setting.use_landscape) icons.push({ icon: Monitor, title: "Landscape" });
  if (setting.max_duration != null) icons.push({ icon: Timer, title: `Max ${setting.max_duration}s` });

  return (
    // Reveal on hover so the footer doesn't obscure content in small/padded
    // tiles; the master "Info" toggle controls whether it renders at all.
    <div className="absolute inset-x-0 bottom-0 bg-black/40 text-white text-[10px] px-1 py-0.5 flex items-center gap-1 min-w-0 opacity-0 transition-opacity group-hover:opacity-100">
      <span className="truncate">{folder || `Tile ${tileIndex + 1}`}</span>
      {icons.length > 0 && (
        <span className="ml-auto flex items-center gap-0.5 shrink-0">
          {icons.map(({ icon: Icon, title }) => (
            <Icon key={title} className="h-2.5 w-2.5 opacity-70" title={title} />
          ))}
        </span>
      )}
    </div>
  );
}

type CropTileWrapperProps = React.ComponentPropsWithoutRef<"div"> & {
  tileIndex: number;
  cropPosition: string;
  active?: boolean;
  onSetCropPosition?: (tileIndex: number, position: string) => void;
};

const CropTileWrapper = React.forwardRef<HTMLDivElement, CropTileWrapperProps>(
  function CropTileWrapper(
    { tileIndex, cropPosition, active, onSetCropPosition, onClick, children, ...rest },
    ref
  ) {
    const [hoveredCell, setHoveredCell] = useState<number | null>(null);

    return (
      <div
        ref={ref}
        {...rest}
        onClick={(e) => {
          if (e.shiftKey && onSetCropPosition && hoveredCell !== null) {
            e.stopPropagation();
            onSetCropPosition(tileIndex, CROP_POSITIONS[hoveredCell]);
            return;
          }
          onClick?.(e);
        }}
        onMouseMove={(e) => setHoveredCell(cellFromMouse(e))}
        onMouseLeave={() => setHoveredCell(null)}
      >
        {children}
        <CropPinOverlay
          cropPosition={cropPosition}
          active={active}
          hoveredCell={hoveredCell}
        />
      </div>
    );
  }
);

/**
 * A single tile's live video, slaved to the timeline playhead. The page passes
 * the active clip's source + the source-time the playhead maps to; this seeks /
 * plays / pauses to follow it. Muted (preview is visual; audio is an export
 * concern). Drift is corrected only past a threshold so playback stays smooth.
 */
function TilePlaybackVideo({
  src,
  clipStart,
  sourceStart,
  rate,
  filmstrip,
  playing,
  playheadRef,
  objectFit,
  objectPosition,
}: TilePlayback & {
  playing: boolean;
  playheadRef?: React.MutableRefObject<number>;
  objectFit: React.CSSProperties["objectFit"];
  objectPosition: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stripImgRef = useRef<HTMLImageElement | null>(null);
  const stripReadyRef = useRef(false);

  // Load the clip's filmstrip sprite once; the rAF blits the cell under the
  // playhead during scrub — instant, no video seek/decode (which WebKit can't
  // repaint while paused anyway).
  useEffect(() => {
    stripReadyRef.current = false;
    stripImgRef.current = null;
    const url = filmstrip?.url;
    if (!url) return;
    // NB: `Image` is shadowed by the lucide-react icon import above, so build the
    // element explicitly rather than `new Image()`.
    const img = document.createElement("img");
    img.onload = () => {
      stripReadyRef.current = true;
    };
    img.onerror = () => {
      stripReadyRef.current = false;
    };
    img.src = url;
    stripImgRef.current = img;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [filmstrip?.url]);

  // Blit the filmstrip cell for a source time. Returns false if unavailable so
  // the caller can fall back to seeking the video.
  const drawFilmstripCell = (sourceTime: number) => {
    const c = canvasRef.current;
    const img = stripImgRef.current;
    if (!c || !img || !stripReadyRef.current || !filmstrip) return false;
    const { frameCount, columns, frameWidth, frameHeight, duration } = filmstrip;
    let idx = Math.floor((sourceTime / Math.max(0.001, duration)) * frameCount);
    idx = Math.max(0, Math.min(frameCount - 1, idx));
    const col = idx % columns;
    const row = Math.floor(idx / columns);
    if (c.width !== frameWidth || c.height !== frameHeight) {
      c.width = frameWidth;
      c.height = frameHeight;
    }
    const ctx = c.getContext("2d");
    if (!ctx) return false;
    try {
      ctx.drawImage(
        img,
        col * frameWidth,
        row * frameHeight,
        frameWidth,
        frameHeight,
        0,
        0,
        frameWidth,
        frameHeight
      );
      return true;
    } catch {
      return false;
    }
  };

  // Blit the video's *decoded* frame onto the canvas (used for playback, and as
  // a scrub fallback when the filmstrip isn't ready).
  const draw = () => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c || v.readyState < 2 || v.videoWidth === 0) return;
    if (c.width !== v.videoWidth || c.height !== v.videoHeight) {
      c.width = v.videoWidth;
      c.height = v.videoHeight;
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    try {
      ctx.drawImage(v, 0, 0, c.width, c.height);
    } catch {
      // frame not ready — the next rAF tick will draw it
    }
  };

  // Drive the (hidden) video off the playhead and continuously blit to the
  // canvas: free-run while playing, seek-and-draw while paused (scrub). Only one
  // seek in flight at a time so WebKit can finish (and decode) each one.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const v = videoRef.current;
      if (v) {
        const r = rate || 1;
        if (v.playbackRate !== r) v.playbackRate = r;
        const target = Math.max(
          0,
          sourceStart + ((playheadRef?.current ?? 0) - clipStart) * r
        );
        if (playing) {
          if (v.paused) void v.play().catch(() => {});
          if (!v.seeking && Number.isFinite(target) && Math.abs(v.currentTime - target) > 0.3) {
            v.currentTime = target;
          }
          draw();
        } else {
          if (!v.paused) v.pause();
          // Scrub: instant filmstrip cell; fall back to a video seek if the
          // sprite isn't ready yet.
          if (!drawFilmstripCell(target)) {
            if (!v.seeking && Number.isFinite(target) && Math.abs(v.currentTime - target) > 0.02) {
              v.currentTime = target;
            }
            draw();
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, rate, clipStart, sourceStart, src, playheadRef, filmstrip]);

  return (
    <div className="relative h-full w-full">
      {/* opacity-0 (not display:none) so the video still decodes/seeks */}
      <video
        ref={videoRef}
        src={src}
        muted
        playsInline
        preload="auto"
        onSeeked={draw}
        onLoadedData={draw}
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ objectFit, objectPosition }}
      />
    </div>
  );
}

export function TileGridPreview({
  layoutCode,
  tileCount,
  folders,
  folderThumbs,
  tileThumbs,
  tileVideos,
  playing,
  playheadRef,
  cropMode,
  tileSettings,
  onPickTile,
  layoutTree,
  onSplit,
  onResizeSplit,
  onRemoveTile,
  onSetCropPosition,
  selectedTileIndex,
  onUpdateTileSetting,
  onToggleTileAudio,
  audioTiles,
  hiddenTiles,
  showSafeZones,
  safeZoneType,
  showTileInfo = true,
  canvasWidth = 1920,
  canvasHeight = 1080,
  padding = 0,
  bgColor = "000000",
}: TileGridPreviewProps) {
  const defaultSetting: TileSettingEntry = {
    trans_type: "none",
    trans_duration: 0,
    crop_position: "center",
    speed: 1.0,
    mode: "video",
    image_duration: 5.0,
    use_landscape: false,
    max_duration: null,
  };
  const audioEnabled = (tileIndex: number) => audioTiles?.includes(tileIndex) ?? false;
  const grid = layoutGrids[layoutCode] || buildGrid(layoutCode, tileCount);
  const fit = cropMode === "stretch" ? "fill" : cropMode === "pad" ? "contain" : "cover";
  const getTileSetting = (tileIndex: number) =>
    tileSettings?.[tileIndex] || defaultSetting;

  // The new model treats 'padding' as an inset for each tile.
  // We use standard CSS px for the grid/editor.
  const gapPx = `${padding}px`;
  const edgePx = `${padding}px`;

  const dividerClassName =
    padding > 0
      ? undefined
      : "w-0 data-[panel-group-direction=vertical]:w-0 data-[panel-group-direction=vertical]:h-0 after:bg-transparent hover:after:bg-transparent before:absolute before:inset-y-0 before:left-1/2 before:w-2 before:-translate-x-1/2 before:content-[''] data-[panel-group-direction=vertical]:before:inset-x-0 data-[panel-group-direction=vertical]:before:top-1/2 data-[panel-group-direction=vertical]:before:h-2 data-[panel-group-direction=vertical]:before:-translate-y-1/2 data-[panel-group-direction=vertical]:before:translate-x-0";

  const renderTileContent = (tileIndex: number) => {
    const folder = folders[tileIndex];
    // Preview-only hide: skip mounting the playback canvas entirely (no rAF/decode
    // loop for hidden tiles), both render paths funnel through here.
    if (hiddenTiles?.has(tileIndex)) {
      return {
        folder,
        thumb: null,
        position: "center",
        cropPosition: "center",
        setting: tileSettings?.[tileIndex] || defaultSetting,
        node: (
          <div className="flex h-full w-full items-center justify-center bg-muted/20">
            <EyeOff className="h-5 w-5 text-muted-foreground/40" />
          </div>
        ),
      };
    }
    const hasPlayback =
      tileVideos && Object.prototype.hasOwnProperty.call(tileVideos, tileIndex);
    const playback = hasPlayback ? tileVideos?.[tileIndex] : null;
    const hasPlayheadThumb = tileThumbs && Object.prototype.hasOwnProperty.call(tileThumbs, tileIndex);
    const thumb = hasPlayheadThumb ? tileThumbs?.[tileIndex] : folder ? folderThumbs?.[folder] : null;
    const cropPosition = tileSettings?.[tileIndex]?.crop_position;
    const position =
      cropPosition === "top"
        ? "center top"
        : cropPosition === "bottom"
        ? "center bottom"
        : cropPosition === "left"
        ? "left center"
        : cropPosition === "right"
        ? "right center"
        : "center";

    return {
      folder,
      thumb,
      position,
      cropPosition: cropPosition || "center",
      setting: tileSettings?.[tileIndex] || defaultSetting,
      node: playback ? (
        <TilePlaybackVideo
          src={playback.src}
          clipStart={playback.clipStart}
          sourceStart={playback.sourceStart}
          rate={playback.rate}
          filmstrip={playback.filmstrip}
          poster={playback.poster}
          playing={!!playing}
          playheadRef={playheadRef}
          objectFit={fit}
          objectPosition={position}
        />
      ) : hasPlayback ? (
        <div className="flex h-full w-full items-center justify-center bg-background text-[10px] font-medium text-muted-foreground/70">
          blank
        </div>
      ) : thumb ? (
        <img
          src={thumb}
          alt={folder}
          className="w-full h-full"
          style={{ objectFit: fit, objectPosition: position }}
          loading="lazy"
        />
      ) : hasPlayheadThumb ? (
        <div className="flex h-full w-full items-center justify-center bg-background text-[10px] font-medium text-muted-foreground/70">
          blank
        </div>
      ) : (
        <div className="bg-muted/60 text-muted-foreground flex items-center justify-center text-xs font-medium w-full h-full">
          <div className="text-center">
            <div className="font-bold">Tile {tileIndex}</div>
            <div className="text-[10px] opacity-70 truncate max-w-20">
              {folder || "unassigned"}
            </div>
          </div>
        </div>
      ),
    };
  };

  return (
    <div className="h-full">
      {!layoutGrids[layoutCode] && (
        <div className="text-xs text-muted-foreground mb-2">
          Auto layout for {layoutCode}
        </div>
      )}
      {layoutTree ? (
        <LayoutEditor
          root={layoutTree}
          onPickTile={onPickTile}
          onSplit={onSplit}
          onResizeSplit={onResizeSplit}
          onRemoveTile={onRemoveTile}
          onSetCropPosition={onSetCropPosition}
          selectedTileIndex={selectedTileIndex}
          onUpdateTileSetting={onUpdateTileSetting}
          onToggleTileAudio={onToggleTileAudio}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          bgColor={bgColor}
          showSafeZones={showSafeZones}
          safeZoneType={safeZoneType}
          getCropPosition={(tileIndex) =>
            tileSettings?.[tileIndex]?.crop_position || "center"
          }
          getTileSetting={getTileSetting}
          getAudioEnabled={audioEnabled}
          edgePadding={edgePx}
          gutterHSize={gapPx}
          gutterVSize={gapPx}
          dividerClassName={dividerClassName}
          renderTile={(tileIndex) => {
            const { folder, node, setting } = renderTileContent(tileIndex);
            return (
              <div className="relative w-full h-full group">
                {node}
                {showTileInfo && (
                  <TileFooter folder={folder} tileIndex={tileIndex} setting={setting} hasAudio={audioEnabled(tileIndex)} />
                )}
              </div>
            );
          }}
        />
      ) : (
        <div
          className="relative border overflow-hidden"
          style={{
            aspectRatio: `${canvasWidth} / ${canvasHeight}`,
            display: "grid",
            gridTemplateColumns: grid.cols,
            gridTemplateRows: grid.rows,
            columnGap: gapPx,
            rowGap: gapPx,
            padding: edgePx,
            backgroundColor: `#${bgColor || "000000"}`,
          }}
        >
          {Array.from({ length: tileCount }, (_, i) => {
            const { folder, node, cropPosition, setting } = renderTileContent(i);
            const tileBody = (
              <CropTileWrapper
                tileIndex={i}
                cropPosition={cropPosition}
                active={selectedTileIndex === i}
                className="relative overflow-hidden cursor-pointer group"
                style={{ gridArea: grid.areas[i] }}
                onClick={() => onPickTile?.(i)}
                onSetCropPosition={onSetCropPosition}
              >
                {node}
                {showTileInfo && (
                  <TileFooter folder={folder} tileIndex={i} setting={setting} hasAudio={audioEnabled(i)} />
                )}
              </CropTileWrapper>
            );

            if (!onSplit && !onRemoveTile && !onSetCropPosition) {
              return <div key={i}>{tileBody}</div>;
            }

            return (
              <ContextMenu key={i}>
                <ContextMenuTrigger asChild>{tileBody}</ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuGroup>
                    <ContextMenuLabel>Audio</ContextMenuLabel>
                    <ContextMenuItem
                      onSelect={(event) => {
                        event.preventDefault();
                        onToggleTileAudio?.(i, !audioEnabled(i));
                      }}
                    >
                      <Volume2 className="mr-2 h-3.5 w-3.5" />
                      Include audio
                      <Switch
                        size="sm"
                        checked={audioEnabled(i)}
                        onCheckedChange={(value) =>
                          onToggleTileAudio?.(i, !!value)
                        }
                        onClick={(event) => event.stopPropagation()}
                        className="ml-auto"
                      />
                    </ContextMenuItem>
                  </ContextMenuGroup>
                  <ContextMenuSeparator />
                  <ContextMenuGroup>
                    <ContextMenuLabel>Crop</ContextMenuLabel>
                    <ContextMenuSub>
                      <ContextMenuSubTrigger>
                        <Crop className="mr-2 h-3.5 w-3.5" />
                        Crop position
                      </ContextMenuSubTrigger>
                      <ContextMenuSubContent>
                        <ContextMenuRadioGroup
                          value={cropPosition}
                          onValueChange={(value) => onSetCropPosition?.(i, value)}
                        >
                          <ContextMenuRadioItem value="top">Top</ContextMenuRadioItem>
                          <ContextMenuRadioItem value="center">Center</ContextMenuRadioItem>
                          <ContextMenuRadioItem value="bottom">Bottom</ContextMenuRadioItem>
                          <ContextMenuRadioItem value="left">Left</ContextMenuRadioItem>
                          <ContextMenuRadioItem value="right">Right</ContextMenuRadioItem>
                        </ContextMenuRadioGroup>
                      </ContextMenuSubContent>
                    </ContextMenuSub>
                  </ContextMenuGroup>
                  <ContextMenuSeparator />
                  <ContextMenuGroup>
                    <ContextMenuLabel>Playback</ContextMenuLabel>
                    <ContextMenuSub>
                      <ContextMenuSubTrigger>
                        <Film className="mr-2 h-3.5 w-3.5" />
                        Transition
                      </ContextMenuSubTrigger>
                      <ContextMenuSubContent>
                        <ContextMenuRadioGroup
                          value={setting.trans_type}
                          onValueChange={(value) =>
                            onUpdateTileSetting?.(i, { trans_type: value })
                          }
                        >
                          <ContextMenuRadioItem value="none">None</ContextMenuRadioItem>
                          <ContextMenuRadioItem value="cut">Cut</ContextMenuRadioItem>
                          <ContextMenuRadioItem value="fade">Fade</ContextMenuRadioItem>
                          <ContextMenuRadioItem value="fadeblack">
                            Fade to Black
                          </ContextMenuRadioItem>
                          <ContextMenuRadioItem value="dissolve">Dissolve</ContextMenuRadioItem>
                        </ContextMenuRadioGroup>
                      </ContextMenuSubContent>
                    </ContextMenuSub>
                    <ContextMenuSub>
                      <ContextMenuSubTrigger>
                        <Timer className="mr-2 h-3.5 w-3.5" />
                        Transition duration
                      </ContextMenuSubTrigger>
                      <ContextMenuSubContent>
                        <ContextMenuRadioGroup
                          value={String(setting.trans_duration)}
                          onValueChange={(value) =>
                            onUpdateTileSetting?.(i, {
                              trans_duration: parseFloat(value),
                            })
                          }
                        >
                          <ContextMenuRadioItem value="0">0s</ContextMenuRadioItem>
                          <ContextMenuRadioItem value="0.5">0.5s</ContextMenuRadioItem>
                          <ContextMenuRadioItem value="1">1s</ContextMenuRadioItem>
                          <ContextMenuRadioItem value="2">2s</ContextMenuRadioItem>
                        </ContextMenuRadioGroup>
                        <ContextMenuSeparator />
                        <CustomNumberInput
                          value={String(setting.trans_duration)}
                          onCommit={(value) => {
                            const next = parseNumber(value);
                            if (next !== null) {
                              onUpdateTileSetting?.(i, { trans_duration: next });
                            }
                          }}
                        />
                      </ContextMenuSubContent>
                    </ContextMenuSub>
                    <ContextMenuSub>
                      <ContextMenuSubTrigger>
                        <Gauge className="mr-2 h-3.5 w-3.5" />
                        Speed
                      </ContextMenuSubTrigger>
                      <ContextMenuSubContent>
                        <ContextMenuRadioGroup
                          value={String(setting.speed)}
                          onValueChange={(value) =>
                            onUpdateTileSetting?.(i, { speed: parseFloat(value) })
                          }
                        >
                          <ContextMenuRadioItem value="0.5">0.5x</ContextMenuRadioItem>
                          <ContextMenuRadioItem value="1">1x</ContextMenuRadioItem>
                          <ContextMenuRadioItem value="1.5">1.5x</ContextMenuRadioItem>
                          <ContextMenuRadioItem value="2">2x</ContextMenuRadioItem>
                        </ContextMenuRadioGroup>
                        <ContextMenuSeparator />
                        <CustomNumberInput
                          value={String(setting.speed)}
                          onCommit={(value) => {
                            const next = parseNumber(value);
                            if (next !== null) {
                              onUpdateTileSetting?.(i, { speed: next });
                            }
                          }}
                        />
                      </ContextMenuSubContent>
                    </ContextMenuSub>
                  </ContextMenuGroup>
                  <ContextMenuSeparator />
                  <ContextMenuGroup>
                    <ContextMenuLabel>Content</ContextMenuLabel>
                    <ContextMenuSub>
                      <ContextMenuSubTrigger>
                        <SplitSquareHorizontal className="mr-2 h-3.5 w-3.5" />
                        Mode
                      </ContextMenuSubTrigger>
                      <ContextMenuSubContent>
                        <ContextMenuRadioGroup
                          value={setting.mode}
                          onValueChange={(value) =>
                            onUpdateTileSetting?.(i, { mode: value })
                          }
                        >
                          <ContextMenuRadioItem value="video">Video</ContextMenuRadioItem>
                          <ContextMenuRadioItem value="image">Image</ContextMenuRadioItem>
                        </ContextMenuRadioGroup>
                      </ContextMenuSubContent>
                    </ContextMenuSub>
                    {setting.mode === "image" && (
                      <ContextMenuSub>
                        <ContextMenuSubTrigger>
                          <Timer className="mr-2 h-3.5 w-3.5" />
                          Image duration
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent>
                          <ContextMenuRadioGroup
                            value={String(setting.image_duration)}
                            onValueChange={(value) =>
                              onUpdateTileSetting?.(i, {
                                image_duration: parseFloat(value),
                              })
                            }
                          >
                            <ContextMenuRadioItem value="3">3s</ContextMenuRadioItem>
                            <ContextMenuRadioItem value="5">5s</ContextMenuRadioItem>
                            <ContextMenuRadioItem value="8">8s</ContextMenuRadioItem>
                          </ContextMenuRadioGroup>
                          <ContextMenuSeparator />
                          <CustomNumberInput
                            value={String(setting.image_duration)}
                            onCommit={(value) => {
                              const next = parseNumber(value);
                              if (next !== null) {
                                onUpdateTileSetting?.(i, { image_duration: next });
                              }
                            }}
                          />
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                    )}
                  </ContextMenuGroup>
                  <ContextMenuSeparator />
                  <ContextMenuGroup>
                    <ContextMenuLabel>Limits</ContextMenuLabel>
                    <ContextMenuSub>
                      <ContextMenuSubTrigger>
                        <Timer className="mr-2 h-3.5 w-3.5" />
                        Max duration
                      </ContextMenuSubTrigger>
                      <ContextMenuSubContent>
                        <ContextMenuRadioGroup
                          value={
                            setting.max_duration === null
                              ? "none"
                              : String(setting.max_duration)
                          }
                          onValueChange={(value) =>
                            onUpdateTileSetting?.(i, {
                              max_duration: value === "none" ? null : parseFloat(value),
                            })
                          }
                        >
                          <ContextMenuRadioItem value="none">Off</ContextMenuRadioItem>
                          <ContextMenuRadioItem value="10">10s</ContextMenuRadioItem>
                          <ContextMenuRadioItem value="30">30s</ContextMenuRadioItem>
                          <ContextMenuRadioItem value="60">60s</ContextMenuRadioItem>
                        </ContextMenuRadioGroup>
                        <ContextMenuSeparator />
                        <CustomNumberInput
                          value={
                            setting.max_duration === null
                              ? ""
                              : String(setting.max_duration)
                          }
                          placeholder="Off"
                          onCommit={(value) => {
                            const trimmed = value.trim();
                            if (!trimmed) {
                              onUpdateTileSetting?.(i, { max_duration: null });
                              return;
                            }
                            const next = parseNumber(trimmed);
                            if (next !== null) {
                              onUpdateTileSetting?.(i, { max_duration: next });
                            }
                          }}
                        />
                      </ContextMenuSubContent>
                    </ContextMenuSub>
                  </ContextMenuGroup>
                  <ContextMenuSeparator />
                  <ContextMenuGroup>
                    <ContextMenuLabel>Layout</ContextMenuLabel>
                    <ContextMenuSub>
                      <ContextMenuSubTrigger>
                        <Rows2 className="mr-2 h-3.5 w-3.5" />
                        Split
                      </ContextMenuSubTrigger>
                      <ContextMenuSubContent>
                        <ContextMenuItem
                          onSelect={() => onSplit?.(i, "column", "before")}
                        >
                          <SplitSquareVertical className="mr-2 h-3.5 w-3.5" />
                          Split Up
                        </ContextMenuItem>
                        <ContextMenuItem
                          onSelect={() => onSplit?.(i, "column", "after")}
                        >
                          <SplitSquareVertical className="mr-2 h-3.5 w-3.5" />
                          Split Down
                        </ContextMenuItem>
                        <ContextMenuItem
                          onSelect={() => onSplit?.(i, "row", "before")}
                        >
                          <SplitSquareHorizontal className="mr-2 h-3.5 w-3.5" />
                          Split Left
                        </ContextMenuItem>
                        <ContextMenuItem
                          onSelect={() => onSplit?.(i, "row", "after")}
                        >
                          <SplitSquareHorizontal className="mr-2 h-3.5 w-3.5" />
                          Split Right
                        </ContextMenuItem>
                      </ContextMenuSubContent>
                      </ContextMenuSub>
                    </ContextMenuGroup>
                    <ContextMenuSeparator />
                    <ContextMenuGroup>
                      <ContextMenuLabel>Tile</ContextMenuLabel>
                      <ContextMenuItem
                        onSelect={() => onRemoveTile?.(i)}
                        disabled={!onRemoveTile}
                      >
                        <Trash2 className="mr-2 h-3.5 w-3.5" />
                        Remove tile
                      </ContextMenuItem>
                    </ContextMenuGroup>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
          {showSafeZones && <SafeZoneOverlay type={safeZoneType} />}
        </div>
      )}
    </div>
  );
}

export type LayoutNode =
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
      children: [LayoutNode, LayoutNode];
    };


function LayoutEditor({
  root,
  onPickTile,
  onSplit,
  onResizeSplit,
  onRemoveTile,
  onSetCropPosition,
  selectedTileIndex,
  onUpdateTileSetting,
  onToggleTileAudio,
  getCropPosition,
  getTileSetting,
  getAudioEnabled,
  renderTile,
  canvasWidth = 1920,
  canvasHeight = 1080,
  bgColor = "000000",
  edgePadding,
  gutterHSize,
  gutterVSize,
  dividerClassName,
  showSafeZones,
  safeZoneType,
}: {
  root: LayoutNode;
  onPickTile?: (index: number) => void;
  onSplit?: (tileIndex: number, direction: "row" | "column", place: "before" | "after") => void;
  onResizeSplit?: (nodeId: string, ratio: number) => void;
  onRemoveTile?: (tileIndex: number) => void;
  onSetCropPosition?: (tileIndex: number, position: string) => void;
  selectedTileIndex?: number | null;
  onUpdateTileSetting?: (tileIndex: number, partial: Partial<TileSettingEntry>) => void;
  onToggleTileAudio?: (tileIndex: number, enabled: boolean) => void;
  getCropPosition: (tileIndex: number) => string;
  getTileSetting: (tileIndex: number) => TileSettingEntry;
  getAudioEnabled: (tileIndex: number) => boolean;
  renderTile: (tileIndex: number) => ReactNode;
  canvasWidth?: number;
  canvasHeight?: number;
  bgColor?: string;
  edgePadding?: string;
  gutterHSize?: string;
  gutterVSize?: string;
  dividerClassName?: string;
  showSafeZones?: boolean;
  safeZoneType?: string | null;
}) {
  return (
    <div
      className="relative border overflow-hidden"
      style={{
        aspectRatio: `${canvasWidth} / ${canvasHeight}`,
        backgroundColor: `#${bgColor || "000000"}`,
        padding: edgePadding,
      }}
    >
      <div className="w-full h-full">
        <LayoutNodeView
          node={root}
          onPickTile={onPickTile}
          onSplit={onSplit}
          onResizeSplit={onResizeSplit}
          onRemoveTile={onRemoveTile}
          onSetCropPosition={onSetCropPosition}
          selectedTileIndex={selectedTileIndex}
          onUpdateTileSetting={onUpdateTileSetting}
          onToggleTileAudio={onToggleTileAudio}
          getCropPosition={getCropPosition}
          getTileSetting={getTileSetting}
          getAudioEnabled={getAudioEnabled}
          renderTile={renderTile}
          gutterHSize={gutterHSize}
          gutterVSize={gutterVSize}
          dividerClassName={dividerClassName}
        />
      </div>
      {showSafeZones && <SafeZoneOverlay type={safeZoneType} />}
    </div>
  );
}

function LayoutNodeView({
  node,
  onPickTile,
  onSplit,
  onResizeSplit,
  onRemoveTile,
  onSetCropPosition,
  selectedTileIndex,
  onUpdateTileSetting,
  onToggleTileAudio,
  getCropPosition,
  getTileSetting,
  getAudioEnabled,
  renderTile,
  gutterHSize,
  gutterVSize,
  dividerClassName,
}: {
  node: LayoutNode;
  onPickTile?: (index: number) => void;
  onSplit?: (tileIndex: number, direction: "row" | "column", place: "before" | "after") => void;
  onResizeSplit?: (nodeId: string, ratio: number) => void;
  onRemoveTile?: (tileIndex: number) => void;
  onSetCropPosition?: (tileIndex: number, position: string) => void;
  selectedTileIndex?: number | null;
  onUpdateTileSetting?: (tileIndex: number, partial: Partial<TileSettingEntry>) => void;
  onToggleTileAudio?: (tileIndex: number, enabled: boolean) => void;
  getCropPosition: (tileIndex: number) => string;
  getTileSetting: (tileIndex: number) => TileSettingEntry;
  getAudioEnabled: (tileIndex: number) => boolean;
  renderTile: (tileIndex: number) => React.ReactNode;
  gutterHSize?: string;
  gutterVSize?: string;
  dividerClassName?: string;
}) {
  if (node.type === "leaf") {
    const cropPosition = getCropPosition(node.tileIndex);
    const setting = getTileSetting(node.tileIndex);
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <CropTileWrapper
            tileIndex={node.tileIndex}
            cropPosition={cropPosition}
            active={selectedTileIndex === node.tileIndex}
            className="relative w-full h-full overflow-hidden cursor-pointer group"
            onClick={() => onPickTile?.(node.tileIndex)}
            onSetCropPosition={onSetCropPosition}
          >
            {renderTile(node.tileIndex)}
          </CropTileWrapper>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuGroup>
            <ContextMenuLabel>Audio</ContextMenuLabel>
            <ContextMenuItem
              onSelect={(event) => {
                event.preventDefault();
                onToggleTileAudio?.(node.tileIndex, !getAudioEnabled(node.tileIndex));
              }}
            >
              <Volume2 className="mr-2 h-3.5 w-3.5" />
              Include audio
              <Switch
                size="sm"
                checked={getAudioEnabled(node.tileIndex)}
                onCheckedChange={(value) =>
                  onToggleTileAudio?.(node.tileIndex, !!value)
                }
                onClick={(event) => event.stopPropagation()}
                className="ml-auto"
              />
            </ContextMenuItem>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuLabel>Crop</ContextMenuLabel>
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Crop className="mr-2 h-3.5 w-3.5" />
                Crop position
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuRadioGroup
                  value={cropPosition}
                  onValueChange={(value) => onSetCropPosition?.(node.tileIndex, value)}
                >
                  <ContextMenuRadioItem value="top">Top</ContextMenuRadioItem>
                  <ContextMenuRadioItem value="center">Center</ContextMenuRadioItem>
                  <ContextMenuRadioItem value="bottom">Bottom</ContextMenuRadioItem>
                  <ContextMenuRadioItem value="left">Left</ContextMenuRadioItem>
                  <ContextMenuRadioItem value="right">Right</ContextMenuRadioItem>
                </ContextMenuRadioGroup>
              </ContextMenuSubContent>
            </ContextMenuSub>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuLabel>Playback</ContextMenuLabel>
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Film className="mr-2 h-3.5 w-3.5" />
                Transition
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuRadioGroup
                  value={setting?.trans_type || "none"}
                  onValueChange={(value) =>
                    onUpdateTileSetting?.(node.tileIndex, { trans_type: value })
                  }
                >
                  <ContextMenuRadioItem value="none">None</ContextMenuRadioItem>
                  <ContextMenuRadioItem value="cut">Cut</ContextMenuRadioItem>
                  <ContextMenuRadioItem value="fade">Fade</ContextMenuRadioItem>
                  <ContextMenuRadioItem value="fadeblack">Fade to Black</ContextMenuRadioItem>
                  <ContextMenuRadioItem value="dissolve">Dissolve</ContextMenuRadioItem>
                </ContextMenuRadioGroup>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Timer className="mr-2 h-3.5 w-3.5" />
                Transition duration
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuRadioGroup
                  value={String(setting?.trans_duration ?? 0)}
                  onValueChange={(value) =>
                    onUpdateTileSetting?.(node.tileIndex, { trans_duration: parseFloat(value) })
                  }
                >
                  <ContextMenuRadioItem value="0">0s</ContextMenuRadioItem>
                  <ContextMenuRadioItem value="0.5">0.5s</ContextMenuRadioItem>
                  <ContextMenuRadioItem value="1">1s</ContextMenuRadioItem>
                  <ContextMenuRadioItem value="2">2s</ContextMenuRadioItem>
                </ContextMenuRadioGroup>
                <ContextMenuSeparator />
                <CustomNumberInput
                  value={String(setting?.trans_duration ?? 0)}
                  onCommit={(value) => {
                    const next = parseNumber(value);
                    if (next !== null) {
                      onUpdateTileSetting?.(node.tileIndex, { trans_duration: next });
                    }
                  }}
                />
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Gauge className="mr-2 h-3.5 w-3.5" />
                Speed
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuRadioGroup
                  value={String(setting?.speed ?? 1)}
                  onValueChange={(value) =>
                    onUpdateTileSetting?.(node.tileIndex, { speed: parseFloat(value) })
                  }
                >
                  <ContextMenuRadioItem value="0.5">0.5x</ContextMenuRadioItem>
                  <ContextMenuRadioItem value="1">1x</ContextMenuRadioItem>
                  <ContextMenuRadioItem value="1.5">1.5x</ContextMenuRadioItem>
                  <ContextMenuRadioItem value="2">2x</ContextMenuRadioItem>
                </ContextMenuRadioGroup>
                <ContextMenuSeparator />
                <CustomNumberInput
                  value={String(setting?.speed ?? 1)}
                  onCommit={(value) => {
                    const next = parseNumber(value);
                    if (next !== null) {
                      onUpdateTileSetting?.(node.tileIndex, { speed: next });
                    }
                  }}
                />
              </ContextMenuSubContent>
            </ContextMenuSub>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuLabel>Content</ContextMenuLabel>
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <SplitSquareHorizontal className="mr-2 h-3.5 w-3.5" />
                Mode
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuRadioGroup
                  value={setting?.mode || "video"}
                  onValueChange={(value) => onUpdateTileSetting?.(node.tileIndex, { mode: value })}
                >
                  <ContextMenuRadioItem value="video">Video</ContextMenuRadioItem>
                  <ContextMenuRadioItem value="image">Image</ContextMenuRadioItem>
                </ContextMenuRadioGroup>
              </ContextMenuSubContent>
            </ContextMenuSub>
            {(setting?.mode || "video") === "image" && (
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <Timer className="mr-2 h-3.5 w-3.5" />
                  Image duration
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  <ContextMenuRadioGroup
                    value={String(setting?.image_duration ?? 5)}
                    onValueChange={(value) =>
                      onUpdateTileSetting?.(node.tileIndex, { image_duration: parseFloat(value) })
                    }
                  >
                    <ContextMenuRadioItem value="3">3s</ContextMenuRadioItem>
                    <ContextMenuRadioItem value="5">5s</ContextMenuRadioItem>
                    <ContextMenuRadioItem value="8">8s</ContextMenuRadioItem>
                  </ContextMenuRadioGroup>
                  <ContextMenuSeparator />
                  <CustomNumberInput
                    value={String(setting?.image_duration ?? 5)}
                    onCommit={(value) => {
                      const next = parseNumber(value);
                      if (next !== null) {
                        onUpdateTileSetting?.(node.tileIndex, { image_duration: next });
                      }
                    }}
                  />
                </ContextMenuSubContent>
              </ContextMenuSub>
            )}
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuLabel>Limits</ContextMenuLabel>
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Timer className="mr-2 h-3.5 w-3.5" />
                Max duration
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuRadioGroup
                  value={
                    setting?.max_duration === null || setting?.max_duration === undefined
                      ? "none"
                      : String(setting.max_duration)
                  }
                  onValueChange={(value) =>
                    onUpdateTileSetting?.(node.tileIndex, {
                      max_duration: value === "none" ? null : parseFloat(value),
                    })
                  }
                >
                  <ContextMenuRadioItem value="none">Off</ContextMenuRadioItem>
                  <ContextMenuRadioItem value="10">10s</ContextMenuRadioItem>
                  <ContextMenuRadioItem value="30">30s</ContextMenuRadioItem>
                  <ContextMenuRadioItem value="60">60s</ContextMenuRadioItem>
                </ContextMenuRadioGroup>
                <ContextMenuSeparator />
                <CustomNumberInput
                  value={
                    setting?.max_duration === null || setting?.max_duration === undefined
                      ? ""
                      : String(setting.max_duration)
                  }
                  placeholder="Off"
                  onCommit={(value) => {
                    const trimmed = value.trim();
                    if (!trimmed) {
                      onUpdateTileSetting?.(node.tileIndex, { max_duration: null });
                      return;
                    }
                    const next = parseNumber(trimmed);
                    if (next !== null) {
                      onUpdateTileSetting?.(node.tileIndex, { max_duration: next });
                    }
                  }}
                />
              </ContextMenuSubContent>
            </ContextMenuSub>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuLabel>Layout</ContextMenuLabel>
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Rows2 className="mr-2 h-3.5 w-3.5" />
                Split
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem
                  onSelect={() => onSplit?.(node.tileIndex, "column", "before")}
                >
                  <SplitSquareVertical className="mr-2 h-3.5 w-3.5" />
                  Split Up
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() => onSplit?.(node.tileIndex, "column", "after")}
                >
                  <SplitSquareVertical className="mr-2 h-3.5 w-3.5" />
                  Split Down
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() => onSplit?.(node.tileIndex, "row", "before")}
                >
                  <SplitSquareHorizontal className="mr-2 h-3.5 w-3.5" />
                  Split Left
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() => onSplit?.(node.tileIndex, "row", "after")}
                >
                  <SplitSquareHorizontal className="mr-2 h-3.5 w-3.5" />
                  Split Right
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuLabel>Tile</ContextMenuLabel>
            <ContextMenuItem
              onSelect={() => onRemoveTile?.(node.tileIndex)}
              disabled={!onRemoveTile}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              Remove tile
            </ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  const direction = node.direction === "row" ? "horizontal" : "vertical";
  const first = Math.round(node.ratio * 100);
  const second = 100 - first;
  // Pick the gutter size that resolves against the flex main axis for this direction.
  const gutter = direction === "horizontal" ? gutterHSize : gutterVSize;
  return (
    <ResizablePanelGroup
      direction={direction}
      className="h-full w-full"
      onLayout={(sizes) => {
        if (!sizes || sizes.length < 2) return;
        const total = sizes[0] + sizes[1];
        if (!total) return;
        onResizeSplit?.(node.id, sizes[0] / total);
      }}
    >
      <ResizablePanel defaultSize={first} minSize={10}>
        <LayoutNodeView
          node={node.children[0]}
          onPickTile={onPickTile}
          onSplit={onSplit}
          onResizeSplit={onResizeSplit}
          onRemoveTile={onRemoveTile}
          onSetCropPosition={onSetCropPosition}
          selectedTileIndex={selectedTileIndex}
          onUpdateTileSetting={onUpdateTileSetting}
          getCropPosition={getCropPosition}
          getTileSetting={getTileSetting}
          onToggleTileAudio={onToggleTileAudio}
          getAudioEnabled={getAudioEnabled}
          renderTile={renderTile}
          gutterHSize={gutterHSize}
          gutterVSize={gutterVSize}
          dividerClassName={dividerClassName}
        />
      </ResizablePanel>
      <ResizableHandle
        className={dividerClassName}
        style={gutter ? {
          flexBasis: gutter,
          minWidth: direction === "horizontal" ? gutter : undefined,
          minHeight: direction === "vertical" ? gutter : undefined,
        } : undefined}
      />
      <ResizablePanel defaultSize={second} minSize={10}>
        <LayoutNodeView
          node={node.children[1]}
          onPickTile={onPickTile}
          onSplit={onSplit}
          onResizeSplit={onResizeSplit}
          onRemoveTile={onRemoveTile}
          onSetCropPosition={onSetCropPosition}
          selectedTileIndex={selectedTileIndex}
          onUpdateTileSetting={onUpdateTileSetting}
          getCropPosition={getCropPosition}
          getTileSetting={getTileSetting}
          onToggleTileAudio={onToggleTileAudio}
          getAudioEnabled={getAudioEnabled}
          renderTile={renderTile}
          gutterHSize={gutterHSize}
          gutterVSize={gutterVSize}
          dividerClassName={dividerClassName}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
