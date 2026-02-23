import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { InfoHover } from "@/components/ui/info-hover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Play } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1 -mr-3 pr-3">
        <Accordion
          type="multiple"
          defaultValue={["layout", "playback"]}
          className="space-y-1"
        >
          {/* Layout */}
          <AccordionItem value="layout">
            <AccordionTrigger className="text-sm">Layout</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Canvas Size</Label>
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
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Canvas size" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1920x1080">1920x1080</SelectItem>
                      <SelectItem value="1080x1920">1080x1920</SelectItem>
                      <SelectItem value="1080x1080">1080x1080</SelectItem>
                      <SelectItem value="3840x2160">3840x2160</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {canvasPresetKey(safeSettings.canvas_width, safeSettings.canvas_height) === "custom" && (
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      className="w-[72px] h-9"
                      value={safeSettings.canvas_width ?? 1920}
                      onChange={(e) =>
                        onUpdateSettings({
                          canvas_width: e.target.value ? parseInt(e.target.value) : null,
                        })
                      }
                      placeholder="W"
                    />
                    <span className="text-xs text-muted-foreground">x</span>
                    <Input
                      type="number"
                      className="w-[72px] h-9"
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
                <Dialog open={presetOpen} onOpenChange={onPresetOpenChange}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="w-full">
                      Choose Layout...
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
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Playback */}
          <AccordionItem value="playback">
            <AccordionTrigger className="text-sm">Playback</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">Output Length Policy</Label>
                    <InfoHover text="How final output duration is determined: shortest tile, longest tile, or fixed duration." />
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
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="shortest">Shortest Tile</SelectItem>
                      <SelectItem value="longest">Longest Tile</SelectItem>
                      <SelectItem value="fixed">Fixed Duration</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">Source Repeat Policy</Label>
                    <InfoHover text="Controls whether a source clip can be reused within a tile or across all tiles." />
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
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="allow">Allow Reuse</SelectItem>
                      <SelectItem value="no_reuse_per_tile">
                        No Reuse Per Tile
                      </SelectItem>
                      <SelectItem value="no_reuse_global">
                        No Reuse Across Tiles
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">Distribution Mode</Label>
                    <InfoHover text="How clips are distributed across tiles when folders contain multiple files." />
                  </div>
                  <Select
                    value={safeSettings.distribution_mode ?? "none"}
                    onValueChange={(v) =>
                      onUpdateSettings({ distribution_mode: v === "none" ? null : v })
                    }
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="round-robin">Round Robin</SelectItem>
                      <SelectItem value="sequential">Sequential</SelectItem>
                      <SelectItem value="random">Random</SelectItem>
                      <SelectItem value="shuffle-round-robin">
                        Shuffle Round Robin
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Canvas */}
          <AccordionItem value="canvas">
            <AccordionTrigger className="text-sm">Canvas</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">Padding</Label>
                    <InfoHover text="Pixel gap between tiles. Visible as background color." />
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step={2}
                      className="w-[80px]"
                      value={safeSettings.padding ?? 0}
                      onChange={(e) =>
                        onUpdateSettings({
                          padding: e.target.value ? parseInt(e.target.value) : 0,
                        })
                      }
                    />
                    <span className="text-xs text-muted-foreground">px</span>
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">Background Color</Label>
                    <InfoHover text="Color shown in gaps between tiles." />
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="color"
                      value={`#${safeSettings.bg_color || "000000"}`}
                      onChange={(e) =>
                        onUpdateSettings({ bg_color: e.target.value.replace("#", "") })
                      }
                      className="w-9 h-9 rounded border cursor-pointer"
                    />
                    <Input
                      className="w-[100px] font-mono text-xs"
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
            </AccordionContent>
          </AccordionItem>

          {/* Audio */}
          <AccordionItem value="audio">
            <AccordionTrigger className="text-sm">Audio</AccordionTrigger>
            <AccordionContent>
              <div className="flex items-center gap-2">
                <Switch
                  checked={safeSettings.audio_enabled ?? false}
                  onCheckedChange={(v) => onUpdateSettings({ audio_enabled: v })}
                />
                <Label className="text-xs">Audio Enabled</Label>
                <InfoHover text="Include audio in the final mix." />
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Duration */}
          <AccordionItem value="duration">
            <AccordionTrigger className="text-sm">Duration</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">Max Duration (per clip)</Label>
                    <InfoHover text="Ignore source clips longer than this duration (in seconds)." />
                  </div>
                  <Input
                    type="number"
                    step="0.1"
                    className="mt-1"
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

                {outputLengthPolicy === "fixed" && (
                  <div>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs">Fixed Output Duration</Label>
                      <InfoHover text="Final output duration in seconds when Output Length Policy is Fixed." />
                    </div>
                    <Input
                      type="number"
                      step="0.1"
                      className="mt-1"
                      value={safeSettings.max_total_duration ?? ""}
                      onChange={(e) =>
                        onUpdateSettings({
                          max_total_duration: e.target.value
                            ? parseFloat(e.target.value)
                            : null,
                        })
                      }
                      placeholder="Set duration"
                    />
                  </div>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Render */}
          <AccordionItem value="render">
            <AccordionTrigger className="text-sm">Render</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Render Mode</Label>
                  <Select
                    value={renderMode}
                    onValueChange={(value) => {
                      onRenderModeChange(value);
                      saveSettings({ ...settings, render_mode: value });
                    }}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Render mode" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="preview">Preview</SelectItem>
                      <SelectItem value="fast-preview">Fast Preview</SelectItem>
                      <SelectItem value="full">Full</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={outputMode === "global"}
                    onCheckedChange={(value) => {
                      const nextMode = value ? "global" : "project";
                      onOutputModeChange(nextMode);
                      saveSettings({ ...settings, output_mode: nextMode });
                    }}
                  />
                  <Label className="text-xs">Export to global</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={noOverwrite}
                    onCheckedChange={(value) => {
                      onNoOverwriteChange(value);
                      saveSettings({ ...settings, no_overwrite: value });
                    }}
                  />
                  <Label className="text-xs">Skip existing</Label>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </ScrollArea>

      <div className="pt-4 sticky bottom-0 bg-background">
        <Button onClick={onRun} disabled={running} className="w-full">
          <Play className="h-3.5 w-3.5" />
          {running ? "Running..." : "Run Tile"}
        </Button>
      </div>
    </div>
  );
}
