import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { InfoHover } from "@/components/ui/info-hover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Play, Layout, PlayCircle, Settings2, Monitor, Music, Loader2 } from "lucide-react";
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
  settings: TileSettings;
  safeSettings: TileSettings;
  layouts: LayoutInfo[];
  renderMode: string;
  outputMode: string;
  noOverwrite: boolean;
  outputLengthPolicy: "shortest" | "longest" | "fixed";
  sourceRepeatPolicy: "allow" | "no_reuse_per_tile" | "no_reuse_global";
  running: boolean;
  folderThumbsSingle: Record<string, string>;
  presetOpen: boolean;
  onPresetOpenChange: (open: boolean) => void;
  onRenderModeChange: (mode: string) => void;
  onOutputModeChange: (mode: string) => void;
  onNoOverwriteChange: (value: boolean) => void;
  onUpdateSettings: (partial: Partial<TileSettings>) => void;
  onPresetSelect: (code: string) => void;
  onRun: () => void;
  saveSettings: (settings: TileSettings, project?: string) => void;
}

export function TileBuilderSidebar({
  settings,
  safeSettings,
  layouts,
  renderMode,
  outputMode,
  noOverwrite,
  outputLengthPolicy,
  sourceRepeatPolicy,
  running,
  folderThumbsSingle,
  presetOpen,
  onPresetOpenChange,
  onRenderModeChange,
  onOutputModeChange,
  onNoOverwriteChange,
  onUpdateSettings,
  onPresetSelect,
  onRun,
  saveSettings,
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

          {/* SECTION: Playback & Distribution */}
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

              <div>
                <div className="flex items-center gap-1.5">
                  <Label className="text-[10px] text-muted-foreground uppercase font-bold">Max Clip Length (s)</Label>
                  <InfoHover text="Caps how much of any single source clip is used. Leave blank for no per-clip limit." />
                </div>
                <Input
                  type="number"
                  step="0.1"
                  className="h-8 text-xs mt-1"
                  value={safeSettings.max_duration ?? ""}
                  onChange={(e) =>
                    onUpdateSettings({
                      max_duration: e.target.value
                        ? parseFloat(e.target.value)
                        : null,
                    })
                  }
                  placeholder="No limit"
                />
              </div>
            </div>
          </section>

          <Separator className="opacity-50" />

          {/* SECTION: Audio & Config */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-primary">
              <Music className="h-4 w-4" />
              <h3 className="text-xs font-bold uppercase tracking-wider">Audio & Config</h3>
            </div>

            <div className="grid grid-cols-1 gap-2.5">
              <div className="flex items-center justify-between p-2 rounded-lg bg-muted/20 border">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <Label className="text-xs">Audio Mix</Label>
                    <InfoHover text="Include audio in the rendered composition. Individual tile audio choices are controlled from tile menus in the preview." />
                  </div>
                  <p className="text-[10px] text-muted-foreground italic">Enable sound in output</p>
                </div>
                <Switch
                  checked={safeSettings.audio_enabled ?? false}
                  onCheckedChange={(v) => onUpdateSettings({ audio_enabled: v })}
                />
              </div>

              <div className="flex items-center justify-between p-2 rounded-lg bg-muted/20 border">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <Label className="text-xs">Safety Mode</Label>
                    <InfoHover text="Skip renders when the intended output already exists, protecting previous exports from accidental replacement." />
                  </div>
                  <p className="text-[10px] text-muted-foreground italic">Skip existing renders</p>
                </div>
                <Switch
                  checked={noOverwrite}
                  onCheckedChange={(value) => {
                    onNoOverwriteChange(value);
                    saveSettings({ ...settings, no_overwrite: value });
                  }}
                />
              </div>

              <div className="flex items-center justify-between p-2 rounded-lg bg-muted/20 border">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <Label className="text-xs">Global Export</Label>
                    <InfoHover text="Save renders to the workspace-level outputs folder instead of this project's outputs folder." />
                  </div>
                  <p className="text-[10px] text-muted-foreground italic">Save to root outputs</p>
                </div>
                <Switch
                  checked={outputMode === "global"}
                  onCheckedChange={(value) => {
                    const nextMode = value ? "global" : "project";
                    onOutputModeChange(nextMode);
                    saveSettings({ ...settings, output_mode: nextMode });
                  }}
                />
              </div>
            </div>
          </section>

        </div>
      </ScrollArea>

      <div className="sticky bottom-0 pt-3 mt-auto border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 space-y-3">
        <section className="space-y-2">
          <div className="flex items-center gap-2 text-primary">
            <Monitor className="h-4 w-4" />
            <h3 className="text-xs font-bold uppercase tracking-wider">Final Output</h3>
          </div>

          <div>
            <div className="flex items-center gap-1.5">
            <Label className="text-[10px] text-muted-foreground uppercase font-bold">Render Quality</Label>
            <InfoHover text="Render preset for final generation. Fast Preview is lowest quality and quickest; Standard Preview is balanced; High Quality Production is for final exports." />
          </div>
            <Select
              value={renderMode}
              onValueChange={(value) => {
                onRenderModeChange(value);
                saveSettings({ ...settings, render_mode: value });
              }}
            >
              <SelectTrigger className="h-9 mt-1">
                <SelectValue placeholder="Render mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="preview">Standard Preview</SelectItem>
                <SelectItem value="fast-preview">Fast Preview (Low Res)</SelectItem>
                <SelectItem value="full">High Quality Production</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </section>

        <Button 
          onClick={onRun} 
          disabled={running} 
          size="lg"
          className="w-full h-12 text-base font-bold shadow-lg gap-2"
        >
          {running ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Rendering...
            </>
          ) : (
            <>
              <Play className="h-5 w-5 fill-current" />
              Generate Tiles
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
