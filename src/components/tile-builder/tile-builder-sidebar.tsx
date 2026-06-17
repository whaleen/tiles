import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { InfoHover } from "@/components/ui/info-hover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Layout, PlayCircle, Settings2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { LayoutPicker } from "@/components/tile-builder/layout-picker";
import { canvasPresetKey } from "@/pages/tile-builder-utils";
import type { TileSettings, LayoutInfo } from "@/types";

interface TileBuilderSidebarProps {
  safeSettings: TileSettings;
  layouts: LayoutInfo[];
  mode: "edit" | "randomized";
  outputLengthPolicy: "shortest" | "longest" | "fixed";
  sourceRepeatPolicy: "allow" | "no_reuse_per_tile" | "no_reuse_global";
  folderThumbsSingle: Record<string, string>;
  presetOpen: boolean;
  onPresetOpenChange: (open: boolean) => void;
  onUpdateSettings: (partial: Partial<TileSettings>) => void;
  onPresetSelect: (code: string) => void;
}

export function TileBuilderSidebar({
  safeSettings,
  layouts,
  mode,
  outputLengthPolicy,
  sourceRepeatPolicy,
  folderThumbsSingle,
  presetOpen,
  onPresetOpenChange,
  onUpdateSettings,
  onPresetSelect,
}: TileBuilderSidebarProps) {
  const isCustomCanvas = canvasPresetKey(safeSettings.canvas_width, safeSettings.canvas_height) === "custom";

  return (
    <div className="flex min-h-0 h-full flex-col overflow-hidden">
      <ScrollArea className="min-h-0 flex-1 pr-4 -mr-4">
        <div className="space-y-6 pb-6">
          
          {/* SECTION: Layout & Canvas */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-primary">
              <Layout className="h-4 w-4" />
              <h3 className="text-xs font-bold uppercase tracking-wider">Composition</h3>
            </div>
            
            <Dialog open={presetOpen} onOpenChange={onPresetOpenChange}>
              <DialogTrigger asChild>
                <Button variant="secondary" size="sm" className="w-full justify-start gap-2 h-9 border shadow-sm">
                  <div className="bg-primary/10 p-1 rounded">
                    <Settings2 className="h-3.5 w-3.5 text-primary" />
                  </div>
                  Change Base Layout...
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl">
                <DialogHeader>
                  <DialogTitle>Presets</DialogTitle>
                  <DialogDescription>
                    Pick a starting layout, then tweak it in the preview.
                  </DialogDescription>
                </DialogHeader>
                <LayoutPicker
                  layouts={layouts.filter((l) => l.code !== "pip")}
                  selected={safeSettings.layout_code || "2x1"}
                  onSelect={onPresetSelect}
                  folders={safeSettings.tile_folders}
                  folderThumbs={folderThumbsSingle}
                  cropMode={safeSettings.crop_mode}
                />
              </DialogContent>
            </Dialog>

            <div className="grid grid-cols-1 gap-3 pt-1">
              <div>
                <div className="flex items-center gap-1.5">
                  <Label className="text-[10px] text-muted-foreground uppercase font-bold">Canvas Size</Label>
                  <InfoHover text="Final output resolution and aspect ratio. Match this to the destination platform, e.g. 16:9 landscape, 9:16 vertical, or square." />
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <Select
                    value={canvasPresetKey(safeSettings.canvas_width, safeSettings.canvas_height)}
                    onValueChange={(value) => {
                      if (value === "custom") {
                        onUpdateSettings({
                          canvas_width: safeSettings.canvas_width ?? 1920,
                          canvas_height: safeSettings.canvas_height ?? 1080,
                        });
                      } else {
                        const [w, h] = value.split("x").map(Number);
                        onUpdateSettings({ canvas_width: w, canvas_height: h });
                      }
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs flex-1">
                      <SelectValue placeholder="Canvas size" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1920x1080">1920x1080 (16:9)</SelectItem>
                      <SelectItem value="1080x1920">1080x1920 (9:16)</SelectItem>
                      <SelectItem value="1080x1080">1080x1080 (1:1)</SelectItem>
                      <SelectItem value="3840x2160">3840x2160 (4K)</SelectItem>
                      <SelectItem value="custom">Custom...</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {isCustomCanvas && (
                  <div className="flex items-center gap-1 mt-2 animate-in fade-in slide-in-from-top-1">
                    <Input
                      type="number"
                      className="h-8 text-xs"
                      value={safeSettings.canvas_width ?? 1920}
                      onChange={(e) =>
                        onUpdateSettings({
                          canvas_width: e.target.value ? parseInt(e.target.value) : null,
                        })
                      }
                      placeholder="W"
                    />
                    <span className="text-[10px] text-muted-foreground">x</span>
                    <Input
                      type="number"
                      className="h-8 text-xs"
                      value={safeSettings.canvas_height ?? 1080}
                      onChange={(e) =>
                        onUpdateSettings({
                          canvas_height: e.target.value ? parseInt(e.target.value) : null,
                        })
                      }
                      placeholder="H"
                    />
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Label className="text-[10px] text-muted-foreground uppercase font-bold">Padding</Label>
                    <InfoHover text="Pixel gap between tiles." />
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step={2}
                      className="w-16 h-8 text-xs"
                      value={safeSettings.padding ?? 0}
                      onChange={(e) =>
                        onUpdateSettings({
                          padding: e.target.value ? parseInt(e.target.value) : 0,
                        })
                      }
                    />
                    <span className="text-[10px] text-muted-foreground">PX</span>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Label className="text-[10px] text-muted-foreground uppercase font-bold">Background</Label>
                    <InfoHover text="Color shown in gaps." />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={`#${safeSettings.bg_color || "000000"}`}
                      onChange={(e) =>
                        onUpdateSettings({ bg_color: e.target.value.replace("#", "") })
                      }
                      className="w-8 h-8 rounded border cursor-pointer bg-transparent p-0 overflow-hidden"
                    />
                    <Input
                      className="w-20 h-8 font-mono text-[10px] uppercase"
                      value={safeSettings.bg_color || "000000"}
                      onChange={(e) =>
                        onUpdateSettings({
                          bg_color: e.target.value.replace("#", "").slice(0, 6),
                        })
                      }
                      placeholder="000000"
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <Separator className="opacity-50" />

          {/* SECTION: Playback & Distribution — legacy shuffle/randomized controls.
              Tile Builder is edit-mode-only now, so `mode` is always "edit" and
              this section never renders. Kept (gated) only so the CLI's legacy
              random/shuffle generation stays scriptable; not for reintroducing a
              persistent Shuffle mode in the UI. */}
          {mode === "randomized" && (
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-primary">
              <PlayCircle className="h-4 w-4" />
              <h3 className="text-xs font-bold uppercase tracking-wider">Timeline</h3>
            </div>

            <div className="space-y-3">
              <div>
                <div className="flex items-center gap-1.5">
                  <Label className="text-[10px] text-muted-foreground uppercase font-bold">Duration Mode</Label>
                  <InfoHover text="Decides how long the final composition runs: stop at the shortest tile, loop shorter tiles until the longest ends, or use a fixed duration." />
                </div>
                <Select
                  value={outputLengthPolicy}
                  onValueChange={(v) =>
                    onUpdateSettings({
                      output_length_policy: v as "shortest" | "longest" | "fixed",
                      no_repeat: v === "shortest",
                    })
                  }
                >
                  <SelectTrigger className="h-8 text-xs mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="shortest">Shortest Tile (No Loop)</SelectItem>
                    <SelectItem value="longest">Longest Tile (Loop others)</SelectItem>
                    <SelectItem value="fixed">Fixed Duration</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {outputLengthPolicy === "fixed" && (
                <div className="animate-in fade-in slide-in-from-top-1 bg-muted/30 p-2 rounded-lg border border-dashed">
                  <div className="flex items-center gap-1.5">
                    <Label className="text-[10px] text-muted-foreground uppercase font-bold">Target Duration (s)</Label>
                    <InfoHover text="Exact final composition length in seconds when Duration Mode is Fixed Duration." />
                  </div>
                  <Input
                    type="number"
                    step="0.1"
                    className="h-8 text-xs mt-1"
                    value={safeSettings.max_total_duration ?? ""}
                    onChange={(e) =>
                      onUpdateSettings({
                        max_total_duration: e.target.value
                          ? parseFloat(e.target.value)
                          : null,
                      })
                    }
                    placeholder="e.g. 15.0"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center gap-1.5">
                    <Label className="text-[10px] text-muted-foreground uppercase font-bold">Distribution</Label>
                    <InfoHover text="How clips are chosen from assigned folders: default order, round-robin across folders, sequential, random, or shuffled round-robin." />
                  </div>
                  <Select
                    value={safeSettings.distribution_mode ?? "none"}
                    onValueChange={(v) =>
                      onUpdateSettings({ distribution_mode: v === "none" ? null : v })
                    }
                  >
                    <SelectTrigger className="h-8 text-xs mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Default</SelectItem>
                      <SelectItem value="round-robin">Round Robin</SelectItem>
                      <SelectItem value="sequential">Sequential</SelectItem>
                      <SelectItem value="random">Random</SelectItem>
                      <SelectItem value="shuffle-round-robin">Shuffle</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <Label className="text-[10px] text-muted-foreground uppercase font-bold">Reuse Clips</Label>
                    <InfoHover text="Controls whether the same source clip may be reused. Global prevents reuse anywhere in the composition; Per Tile prevents reuse within one tile." />
                  </div>
                  <Select
                    value={sourceRepeatPolicy}
                    onValueChange={(v) =>
                      onUpdateSettings({
                        source_repeat_policy: v as
                          | "allow"
                          | "no_reuse_per_tile"
                          | "no_reuse_global",
                      })
                    }
                  >
                    <SelectTrigger className="h-8 text-xs mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="allow">Allow</SelectItem>
                      <SelectItem value="no_reuse_per_tile">Per Tile</SelectItem>
                      <SelectItem value="no_reuse_global">Global</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </section>
          )}

        </div>
      </ScrollArea>
    </div>
  );
}
