import React, { useState, type ReactNode } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Input } from "@/components/ui/input";
import {
  Crop,
  Film,
  Gauge,
  Rows2,
  SplitSquareHorizontal,
  SplitSquareVertical,
  Timer,
  Trash2,
  Volume2,
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

interface TileGridPreviewProps {
  layoutCode: string;
  tileCount: number;
  folders: string[];
  folderThumbs?: Record<string, string>;
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

export function TileGridPreview({
  layoutCode,
  tileCount,
  folders,
  folderThumbs,
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
  // Horizontal gutter resolves against flex container width; vertical against height.
  // Compute separately so vertical splits get the correct pixel size.
  const gutterHPct = padding > 0 ? `${(padding / canvasWidth) * 100}%` : undefined;
  const gutterVPct = padding > 0 ? `${(padding / canvasHeight) * 100}%` : undefined;
  // CSS padding-% is always width-relative, so a single value works for all sides.
  const edgePct = padding > 0 ? `${(padding / canvasWidth) * 50}%` : undefined;
  const dividerClassName =
    padding > 0
      ? undefined
      : "w-0 data-[panel-group-direction=vertical]:w-0 data-[panel-group-direction=vertical]:h-0 after:bg-transparent hover:after:bg-transparent before:absolute before:inset-y-0 before:left-1/2 before:w-2 before:-translate-x-1/2 before:content-[''] data-[panel-group-direction=vertical]:before:inset-x-0 data-[panel-group-direction=vertical]:before:top-1/2 data-[panel-group-direction=vertical]:before:h-2 data-[panel-group-direction=vertical]:before:-translate-y-1/2 data-[panel-group-direction=vertical]:before:translate-x-0";

  const renderTileContent = (tileIndex: number) => {
    const folder = folders[tileIndex];
    const thumb = folder ? folderThumbs?.[folder] : null;
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
      node: thumb ? (
        <img
          src={thumb}
          alt={folder}
          className="w-full h-full"
          style={{ objectFit: fit, objectPosition: position }}
          loading="lazy"
        />
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
    <div>
      <h3 className="text-sm font-medium mb-2">Preview</h3>
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
          getCropPosition={(tileIndex) =>
            tileSettings?.[tileIndex]?.crop_position || "center"
          }
          getTileSetting={getTileSetting}
          getAudioEnabled={audioEnabled}
          edgePadding={edgePct}
          gutterHSize={gutterHPct}
          gutterVSize={gutterVPct}
          dividerClassName={dividerClassName}
          renderTile={(tileIndex) => {
            const { folder, node } = renderTileContent(tileIndex);
            return (
              <div className="relative w-full h-full group">
                {node}
                <div className="absolute inset-x-0 bottom-0 bg-black/40 text-white text-[10px] px-1 py-0.5 truncate">
                  {folder || `Tile ${tileIndex + 1}`}
                </div>
              </div>
            );
          }}
        />
      ) : (
        <div
          className="border overflow-hidden"
          style={{
            aspectRatio: `${canvasWidth} / ${canvasHeight}`,
            display: "grid",
            gridTemplateColumns: grid.cols,
            gridTemplateRows: grid.rows,
            columnGap: gutterHPct ?? "0px",
            rowGap: gutterVPct ?? "0px",
            padding: edgePct,
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
                <div className="absolute inset-x-0 bottom-0 bg-black/40 text-white text-[10px] px-1 py-0.5 truncate">
                  {folder || `Tile ${i + 1}`}
                </div>
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
}) {
  return (
    <div
      className="border overflow-hidden"
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
