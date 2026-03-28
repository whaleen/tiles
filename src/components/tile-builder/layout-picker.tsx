import { cn } from "@/lib/utils";
import { layoutGrids, buildGrid } from "./layout-grids";
import type { LayoutInfo } from "@/types";

interface LayoutPickerProps {
  layouts: LayoutInfo[];
  selected: string;
  onSelect: (code: string) => void;
  folders?: string[];
  folderThumbs?: Record<string, string>;
  cropMode?: string | null;
}

export function LayoutPicker({
  layouts,
  selected,
  onSelect,
  folders = [],
  folderThumbs,
  cropMode,
}: LayoutPickerProps) {
  const fit = cropMode === "stretch" ? "fill" : cropMode === "pad" ? "contain" : "cover";
  return (
    <div>
      <h3 className="text-sm font-medium mb-2">Layout</h3>
      <div className="grid grid-cols-1 gap-2 max-h-[calc(100vh-220px)] overflow-auto pr-1">
        {layouts.map((layout) => (
          <button
            key={layout.code}
            onClick={() => onSelect(layout.code)}
            className={cn(
              "border rounded-md p-2 text-left transition-all",
              selected === layout.code
                ? "border-primary bg-accent"
                : "hover:border-primary/50"
            )}
          >
            <div
              className="aspect-video border rounded bg-muted/30"
              style={gridStyle(layout.code, layout.tile_count)}
            >
              {Array.from({ length: layout.tile_count }, (_, i) => {
                const folder = folders[i];
                const thumb = folder ? folderThumbs?.[folder] : null;
                return (
                  <div
                    key={i}
                    className="relative overflow-hidden bg-muted/60 text-[10px] text-muted-foreground flex items-center justify-center"
                    style={{ gridArea: gridStyle(layout.code, layout.tile_count).areas[i] }}
                  >
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={folder}
                        className="w-full h-full"
                        style={{ objectFit: fit }}
                        loading="lazy"
                      />
                    ) : (
                      i + 1
                    )}
                  </div>
                );
              })}
            </div>
            <div className="text-xs mt-1 text-muted-foreground">
              {layout.code} ({layout.tile_count} tiles)
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function gridStyle(code: string, tileCount: number) {
  const grid = layoutGrids[code] || buildGrid(code, tileCount);
  return {
    display: "grid",
    gridTemplateColumns: grid.cols,
    gridTemplateRows: grid.rows,
    gap: "2px",
    areas: grid.areas,
  } as const;
}

