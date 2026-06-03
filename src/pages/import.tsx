import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { bumpMediaCache } from "@/api/client";
import { useDownloads } from "@/contexts/download-context";
import { useActionRunner } from "@/hooks/use-action-runner";
import { useProjectDetail } from "@/hooks/use-project-detail";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InfoHover } from "@/components/ui/info-hover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, FolderOpen, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import type {
  UrlImportAnalysis,
  UrlImportCandidate,
  YtDlpStatus,
} from "@/types";

export function ImportPage({ project }: { project?: string }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Import</h2>
        <p className="text-sm text-muted-foreground">
          Bring videos into {project || "a selected project"} from disk, arbitrary URLs, or the split-frame workflow.
        </p>
      </div>

      <Tabs defaultValue="url" className="space-y-4">
        <TabsList>
          <TabsTrigger value="local">Local</TabsTrigger>
          <TabsTrigger value="url">URL / yt-dlp</TabsTrigger>
          <TabsTrigger value="split">Split Frame</TabsTrigger>
        </TabsList>
        <TabsContent value="local">
          <LocalImport project={project} />
        </TabsContent>
        <TabsContent value="url">
          <UrlImport project={project} />
        </TabsContent>
        <TabsContent value="split">
          <SplitFrameImport project={project} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LocalImport({ project }: { project?: string }) {
  const [localFiles, setLocalFiles] = useState<string[]>([]);
  const [localImporting, setLocalImporting] = useState(false);

  const pickLocalFiles = async () => {
    const picked = await open({
      multiple: true,
      filters: [{ name: "Videos", extensions: ["mp4", "mov", "mkv", "avi", "m4v", "webm", "wmv", "mts", "m2ts"] }],
    });
    if (picked) setLocalFiles(Array.isArray(picked) ? picked : [picked]);
  };

  const runLocalImport = async () => {
    if (!localFiles.length || !project) return;
    setLocalImporting(true);
    try {
      const result = await invoke<{ copied: number; skipped: number }>("import_files_to_folder", {
        project,
        folder: "",
        files: localFiles,
      });
      toast.success(`Imported ${result.copied} file${result.copied !== 1 ? "s" : ""}`, {
        description: result.skipped > 0 ? `${result.skipped} skipped` : undefined,
      });
      setLocalFiles([]);
      bumpMediaCache();
    } catch (err) {
      toast.error("Import failed", { description: String(err) });
    } finally {
      setLocalImporting(false);
    }
  };

  return (
    <Panel title="Local Files" description={project ? `Copy files into ${project}` : "Select a project to import"}>
      <div className="space-y-3">
        <Button size="sm" variant="outline" onClick={pickLocalFiles} disabled={!project} className="gap-2">
          <FolderOpen className="h-3.5 w-3.5" />
          Choose files
        </Button>
        {localFiles.length > 0 && (
          <div className="space-y-1 rounded-md border bg-background/60 p-2">
            {localFiles.map((f) => (
              <div key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="truncate flex-1">{f.split("/").pop()}</span>
                <button onClick={() => setLocalFiles((prev) => prev.filter((p) => p !== f))} className="shrink-0 hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <Button size="sm" onClick={runLocalImport} disabled={!project || !localFiles.length || localImporting}>
          {localImporting ? "Importing..." : `Import ${localFiles.length || ""} file${localFiles.length !== 1 ? "s" : ""}`}
        </Button>
      </div>
    </Panel>
  );
}

function UrlImport({ project }: { project?: string }) {
  const [status, setStatus] = useState<YtDlpStatus | null>(null);
  const [urlsText, setUrlsText] = useState("");
  const { detail } = useProjectDetail(project);
  const [folder, setFolder] = useState("imports");
  const [analysis, setAnalysis] = useState<UrlImportAnalysis | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [analyzingMode, setAnalyzingMode] = useState<"fast" | "deep" | null>(null);
  const [tool, setTool] = useState<"ytdlp" | "gallery-dl">("ytdlp");
  const [quality, setQuality] = useState("best-compatible");
  const [writeSubs, setWriteSubs] = useState(true);
  const [writeAutoSubs, setWriteAutoSubs] = useState(true);
  const [subtitleLanguages, setSubtitleLanguages] = useState("en.*,en");
  const [writeInfoJson, setWriteInfoJson] = useState(false);
  const [writeThumbnail, setWriteThumbnail] = useState(false);
  const [useCookies, setUseCookies] = useState(false);
  const [browserChoice, setBrowserChoice] = useState("chrome");
  const [includeImages, setIncludeImages] = useState(false);

  useEffect(() => {
    invoke<YtDlpStatus>("check_ytdlp").then(setStatus).catch(() => setStatus(null));
  }, []);

  const inputUrls = useMemo(() => splitUrls(urlsText), [urlsText]);
  const folderOptions = useMemo(() => {
    const options = new Set(["imports", ...(detail?.subfolders ?? [])]);
    return Array.from(options).sort((a, b) => {
      if (a === "imports") return -1;
      if (b === "imports") return 1;
      return a.localeCompare(b);
    });
  }, [detail?.subfolders]);
  const candidates = useMemo(() => analysis?.sources.flatMap((source) => source.candidates) ?? [], [analysis]);
  const selectableCandidates = useMemo(
    () =>
      analysis?.sources.flatMap((source) =>
        source.candidates.map((candidate, index) => ({
          key: candidateKey(source.url, candidate, index),
          candidate,
        }))
      ) ?? [],
    [analysis]
  );
  const selectedUrls = useMemo(
    () => selectableCandidates.filter((item) => selected.has(item.key)).map((item) => item.candidate.url),
    [selectableCandidates, selected]
  );

  const analyze = async (mode: "fast" | "deep") => {
    if (!inputUrls.length) return toast.error("Paste at least one URL");
    setAnalyzingMode(mode);
    try {
      const result = await invoke<UrlImportAnalysis>("analyze_url_import", {
        urls: inputUrls,
        mode,
        tool: tool === "gallery-dl" ? "gallery-dl" : null,
        cookiesFromBrowser: useCookies ? browserChoice : null,
      });
      setAnalysis(result);
      const all = result.sources.flatMap((source) =>
        source.candidates.map((candidate, index) => candidateKey(source.url, candidate, index))
      );
      setSelected(new Set(all));
      const errors = result.sources.filter((source) => source.error).length;
      toast.success(`${mode === "fast" ? "Fast" : "Deep"} analysis complete`, {
        description: `${all.length} importable candidate${all.length === 1 ? "" : "s"}${errors ? ` · ${errors} error${errors === 1 ? "" : "s"}` : ""}`,
      });
    } catch (err) {
      toast.error("Analysis failed", { description: String(err) });
    } finally {
      setAnalyzingMode(null);
    }
  };

  const downloadSelected = () => {
    if (!project) return toast.error("Select a project");
    const isGalleryDl = tool === "gallery-dl";
    const urlsToDownload = isGalleryDl
      ? (analysis?.sources.map((s) => s.url) ?? [])
      : selectedUrls;
    if (!urlsToDownload.length)
      return toast.error(isGalleryDl ? "Analyze a URL first" : "Select at least one candidate");
    enqueue(project, folder, urlsToDownload, {
      quality,
      write_subtitles: writeSubs,
      write_auto_captions: writeAutoSubs,
      subtitle_languages: subtitleLanguages,
      write_info_json: writeInfoJson,
      write_thumbnail: writeThumbnail,
      cookies_from_browser: useCookies ? browserChoice : null,
      include_images: isGalleryDl ? true : includeImages,
      tool: isGalleryDl ? "gallery-dl" : undefined,
    });
    const count = urlsToDownload.length;
    toast.success(`Queued ${isGalleryDl ? `${count} gallery${count !== 1 ? " URLs" : ""}` : `${count} video${count !== 1 ? "s" : ""}`}`, {
      description: `${project} / ${folder}`,
    });
    setSelected(new Set());
  };

  const { enqueue } = useDownloads();

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
      <Panel title="Analyze URLs" description="Paste arbitrary yt-dlp-supported URLs. Fast mode expands broad pages quickly; deep mode resolves exact duration, formats, and subtitles when the site exposes them.">
        <div className="space-y-4">
          {status && (!status.yt_dlp || !status.ffmpeg || (tool === "gallery-dl" && !status.gallery_dl)) && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs space-y-0.5">
              {!status.yt_dlp && <div>yt-dlp is required: <code>brew install yt-dlp</code></div>}
              {!status.ffmpeg && <div>ffmpeg is required: <code>brew install ffmpeg</code></div>}
              {tool === "gallery-dl" && !status.gallery_dl && <div>gallery-dl is required: <code>brew install gallery-dl</code></div>}
            </div>
          )}
          <div className="space-y-1.5">
            <LabelWithInfo label="Download tool" info="yt-dlp handles video platforms (YouTube, Vimeo, X, etc.). gallery-dl specialises in image galleries (Pixiv, Instagram, Tumblr, Booru sites, etc.)." />
            <div className="flex gap-2">
              <Button size="sm" variant={tool === "ytdlp" ? "default" : "outline"} onClick={() => setTool("ytdlp")} className="gap-1.5">
                yt-dlp {status?.yt_dlp_version && <span className="text-[10px] opacity-60">v{status.yt_dlp_version}</span>}
              </Button>
              <Button size="sm" variant={tool === "gallery-dl" ? "default" : "outline"} onClick={() => setTool("gallery-dl")} className="gap-1.5">
                gallery-dl {status?.gallery_dl_version && <span className="text-[10px] opacity-60">v{status.gallery_dl_version}</span>}
                {status && !status.gallery_dl && <span className="text-[10px] opacity-60">(not found)</span>}
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <LabelWithInfo
              label="URLs"
              info="Paste one or more URLs supported by yt-dlp. Newlines, spaces, and commas are accepted. Fast analysis is best for broad pages/playlists; deep analysis asks yt-dlp for richer media details."
            />
            <textarea
              value={urlsText}
              onChange={(e) => setUrlsText(e.target.value)}
              placeholder={"https://...\nhttps://..."}
              className="min-h-28 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="text-[11px] text-muted-foreground">{inputUrls.length} URL{inputUrls.length === 1 ? "" : "s"} parsed</div>
          </div>
          <div className="space-y-1.5">
            <LabelWithInfo
              label="Destination folder"
              info="Imported videos are saved inside this project folder. The default imports folder is source media and appears in the Library like any other project folder."
            />
            <Select value={folder} onValueChange={setFolder} disabled={!project}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a project folder" />
              </SelectTrigger>
              <SelectContent>
                {folderOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option === "imports" ? "imports (default)" : option}
                  </SelectItem>
                ))}
                {!folderOptions.includes(folder) && folder && (
                  <SelectItem value={folder}>{folder}</SelectItem>
                )}
              </SelectContent>
            </Select>
            <Input
              value={folder}
              onChange={(e) => setFolder(e.target.value.replace(/^\/+/, ""))}
              placeholder="imports, raw, folder/subfolder..."
              disabled={!project}
            />
            <div className="text-[11px] text-muted-foreground">
              Defaults to <code>imports</code>. Pick an existing project folder above or type a new one here.
            </div>
          </div>
          <CookieControls useCookies={useCookies} setUseCookies={setUseCookies} browserChoice={browserChoice} setBrowserChoice={setBrowserChoice} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => analyze("fast")} disabled={!!analyzingMode || !inputUrls.length} className="gap-2">
              {analyzingMode === "fast" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              {tool === "gallery-dl" ? "Analyze" : "Fast analyze"}
            </Button>
            {tool === "ytdlp" && (
              <Button size="sm" variant="outline" onClick={() => analyze("deep")} disabled={!!analyzingMode || !inputUrls.length} className="gap-2">
                {analyzingMode === "deep" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                Deep analyze
              </Button>
            )}
          </div>
          {tool === "gallery-dl" && analysis && (
            <p className="text-[11px] text-muted-foreground">
              gallery-dl downloads the full gallery URL — item checkboxes are for preview only.
            </p>
          )}
        </div>
      </Panel>

      <Panel title="Select & Download" description="The UI hides webpage junk and only lists media candidates returned by yt-dlp.">
        <div className="space-y-4">
          <DownloadOptions
            quality={quality}
            setQuality={setQuality}
            writeSubs={writeSubs}
            setWriteSubs={setWriteSubs}
            writeAutoSubs={writeAutoSubs}
            setWriteAutoSubs={setWriteAutoSubs}
            subtitleLanguages={subtitleLanguages}
            setSubtitleLanguages={setSubtitleLanguages}
            writeInfoJson={writeInfoJson}
            setWriteInfoJson={setWriteInfoJson}
            writeThumbnail={writeThumbnail}
            setWriteThumbnail={setWriteThumbnail}
            includeImages={includeImages}
            setIncludeImages={setIncludeImages}
          />

          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              {selectedUrls.length} of {candidates.length} candidate{candidates.length === 1 ? "" : "s"} selected
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={!candidates.length}>Clear</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(selectableCandidates.map((item) => item.key)))} disabled={!candidates.length}>Select all</Button>
              <Button
                size="sm"
                onClick={downloadSelected}
                disabled={!project || (tool === "gallery-dl" ? !analysis : !selectedUrls.length)}
                className="gap-2"
              >
                <Download className="h-3.5 w-3.5" />
                {tool === "gallery-dl" ? "Download gallery" : "Download selected"}
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            {analysis?.sources.map((source) => (
              <div key={source.url} className="rounded-lg border bg-background/60 p-3">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{source.title || source.url}</div>
                    <div className="text-[11px] text-muted-foreground truncate max-w-xl">{source.url}</div>
                  </div>
                  <Badge variant={source.error ? "destructive" : "secondary"}>{source.kind}</Badge>
                </div>
                {source.error && <div className="text-xs text-destructive">{source.error}</div>}
                <div className="space-y-2">
                  {source.candidates.map((candidate, index) => {
                    const key = candidateKey(source.url, candidate, index);
                    return (
                      <CandidateRow key={key} candidate={candidate} checked={selected.has(key)} onToggle={() => toggle(key)} />
                    );
                  })}
                </div>
              </div>
            ))}
            {!analysis && <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">Analyze URLs to choose specific videos, playlist entries, subtitles, and download quality.</div>}
          </div>
        </div>
      </Panel>
    </div>
  );
}

function DownloadOptions(props: {
  quality: string; setQuality: (v: string) => void;
  writeSubs: boolean; setWriteSubs: (v: boolean) => void;
  writeAutoSubs: boolean; setWriteAutoSubs: (v: boolean) => void;
  subtitleLanguages: string; setSubtitleLanguages: (v: string) => void;
  writeInfoJson: boolean; setWriteInfoJson: (v: boolean) => void;
  writeThumbnail: boolean; setWriteThumbnail: (v: boolean) => void;
  includeImages: boolean; setIncludeImages: (v: boolean) => void;
}) {
  return (
    <div className="grid gap-3 rounded-md border bg-muted/20 p-3 md:grid-cols-2">
      <div className="space-y-1.5">
        <LabelWithInfo
          label="Quality"
          info="Controls the yt-dlp format selector. Best compatible MP4 prefers MP4 video plus M4A audio for app/ffmpeg compatibility; Best available lets yt-dlp choose the highest quality even if the container is less predictable."
        />
        <Select value={props.quality} onValueChange={props.setQuality}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="best-compatible">Best compatible MP4</SelectItem>
            <SelectItem value="best">Best available</SelectItem>
            <SelectItem value="2160">Best up to 2160p</SelectItem>
            <SelectItem value="1440">Best up to 1440p</SelectItem>
            <SelectItem value="1080">Best up to 1080p</SelectItem>
            <SelectItem value="720">Best up to 720p</SelectItem>
            <SelectItem value="audio">Audio only</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <LabelWithInfo
          label="Subtitle languages"
          info="yt-dlp subtitle language selector. The default en.*,en grabs English variants. Use all to grab every available language."
        />
        <Input value={props.subtitleLanguages} onChange={(e) => props.setSubtitleLanguages(e.target.value)} placeholder="en.*,en or all" />
      </div>
      <Toggle
        label="Import human subtitles"
        info="Downloads creator-provided subtitle files when yt-dlp can find them. These are usually higher quality than generated captions."
        checked={props.writeSubs}
        onCheckedChange={props.setWriteSubs}
      />
      <Toggle
        label="Use auto captions if available"
        info="Downloads automatically generated captions, such as YouTube auto captions. Useful when human subtitles are missing."
        checked={props.writeAutoSubs}
        onCheckedChange={props.setWriteAutoSubs}
      />
      <Toggle
        label="Save yt-dlp info JSON"
        info="Saves yt-dlp metadata next to the video for debugging or archival use. Off by default to keep imports tidy."
        checked={props.writeInfoJson}
        onCheckedChange={props.setWriteInfoJson}
      />
      <Toggle
        label="Save thumbnails"
        info="Saves source thumbnails next to imported media. Off by default because the app can generate its own video thumbnails."
        checked={props.writeThumbnail}
        onCheckedChange={props.setWriteThumbnail}
      />
      <Toggle
        label="Include images"
        info="Count and report image files (jpg, png, gif, webp) found after download. Useful for platforms like Twitter/X or Instagram where the content is images."
        checked={props.includeImages}
        onCheckedChange={props.setIncludeImages}
      />
      <div className="md:col-span-2 text-[11px] text-muted-foreground">
        Subtitles are saved next to imported videos as .vtt/.srt, so the existing transcript viewer can pick them up like local transcriptions.
      </div>
    </div>
  );
}

function CookieControls(props: { useCookies: boolean; setUseCookies: (v: boolean) => void; browserChoice: string; setBrowserChoice: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <Toggle
        label="Use browser cookies"
        info="Lets yt-dlp read cookies from a local browser for sites that require login, age checks, memberships, or region/session state."
        checked={props.useCookies}
        onCheckedChange={props.setUseCookies}
      />
      {props.useCookies && (
        <Select value={props.browserChoice} onValueChange={props.setBrowserChoice}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="chrome">Chrome</SelectItem>
            <SelectItem value="brave">Brave</SelectItem>
            <SelectItem value="edge">Edge</SelectItem>
            <SelectItem value="firefox">Firefox</SelectItem>
            <SelectItem value="safari">Safari</SelectItem>
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function CandidateRow({ candidate, checked, onToggle }: { candidate: UrlImportCandidate; checked: boolean; onToggle: () => void }) {
  return (
    <div className="flex gap-3 rounded-md border bg-muted/10 p-2">
      <Checkbox checked={checked} onCheckedChange={onToggle} className="mt-1" />
      {candidate.thumbnail && <img src={candidate.thumbnail} alt="" className="h-14 w-24 rounded object-cover" />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{candidate.playlist_index ? `${candidate.playlist_index}. ` : ""}{candidate.title}</div>
        <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
          {candidate.uploader && <span>{candidate.uploader}</span>}
          {(candidate.duration != null || candidate.duration_string) ? (
            <span>{candidate.duration != null ? formatDuration(candidate.duration) : candidate.duration_string}</span>
          ) : (
            <span className="text-muted-foreground/70">duration unknown</span>
          )}
          {candidate.ext ? <Badge variant="secondary">{candidate.ext.toUpperCase()}</Badge> : <Badge variant="outline">type after deep analyze</Badge>}
          {candidate.resolution && <span>{candidate.resolution}</span>}
          {candidate.format_count > 1 && <span>{candidate.format_count} formats</span>}
          {candidate.subtitles.length > 0 && <Badge variant="outline">subs: {candidate.subtitles.slice(0, 3).join(", ")}</Badge>}
          {candidate.automatic_captions.length > 0 && <Badge variant="outline">auto: {candidate.automatic_captions.slice(0, 3).join(", ")}</Badge>}
        </div>
      </div>
    </div>
  );
}

function SplitFrameImport({ project }: { project?: string }) {
  const runnerScope = project ?? "__split-import-none__";
  const { running, runAction } = useActionRunner(runnerScope);
  const [url, setUrl] = useState("");
  const [forceTwoPanel, setForceTwoPanel] = useState(true);
  const [quality, setQuality] = useState("medium");
  const [clipSeconds, setClipSeconds] = useState("");
  const [fastPreview, setFastPreview] = useState(true);
  const [useBrowserCookies, setUseBrowserCookies] = useState(true);
  const [browserChoice, setBrowserChoice] = useState("chrome");

  const run = async () => {
    const trimmed = url.trim();
    if (!trimmed) return toast.error("Enter a URL");
    if (!project) return toast.error("Select a project");
    const res = await runAction({
      action: "yt-import",
      targets: [trimmed],
      target_type: "url",
      output_mode: "project",
      params: {
        output: `src/${project}/outputs/yt-import`,
        force_two_panel: forceTwoPanel,
        quality,
        clip_seconds: clipSeconds ? parseFloat(clipSeconds) : undefined,
        cookies_from_browser: useBrowserCookies ? browserChoice : undefined,
        fast_preview: fastPreview,
      },
    });
    if (res?.exit_code === 0) {
      toast.success("Split-frame import complete");
      bumpMediaCache();
      setUrl("");
    } else if (res) {
      toast.error("Split-frame import failed", { description: res.output.slice(0, 180) });
    }
  };

  return (
    <Panel title="Split Frame Import" description="The original one-off workflow: download a URL, fetch captions, and split/crop the video into tile folders.">
      <div className="max-w-xl space-y-4">
        <div className="space-y-1.5"><LabelWithInfo label="URL" info="A single URL for the legacy split-frame workflow. Use the URL / yt-dlp tab for selectable multi-URL imports." /><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." /></div>
        <Toggle
          label="Force two-panel split (left/right)"
          info="Always crops the downloaded video into left and right halves instead of trying to detect split-screen regions."
          checked={forceTwoPanel}
          onCheckedChange={setForceTwoPanel}
        />
        <Toggle
          label="Fast preview (downscale + low fps)"
          info="Speeds up split-frame test runs by rendering lower-resolution, lower-framerate preview clips."
          checked={fastPreview}
          onCheckedChange={setFastPreview}
        />
        <CookieControls useCookies={useBrowserCookies} setUseCookies={setUseBrowserCookies} browserChoice={browserChoice} setBrowserChoice={setBrowserChoice} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <LabelWithInfo label="Quality" info="Encoding quality used when creating split-frame crop outputs after download." />
            <Select value={quality} onValueChange={setQuality}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="ultra">Ultra</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><LabelWithInfo label="Clip seconds" info="Optional test limit. When set, only this many seconds are processed instead of the full video." /><Input type="number" value={clipSeconds} onChange={(e) => setClipSeconds(e.target.value)} placeholder="Full length" /></div>
        </div>
        <Button onClick={run} disabled={running || !project}>{running ? "Running..." : "Run split-frame import"}</Button>
      </div>
    </Panel>
  );
}

function Panel({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <div className="mb-4">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      {children}
    </div>
  );
}

function Toggle({
  label,
  info,
  checked,
  onCheckedChange,
}: {
  label: string;
  info?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
      <Label className="text-xs">{label}</Label>
      {info && <InfoHover text={info} />}
    </div>
  );
}

function LabelWithInfo({ label, info }: { label: string; info: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Label className="text-xs">{label}</Label>
      <InfoHover text={info} />
    </div>
  );
}

function splitUrls(raw: string) {
  return raw.split(/[\s,]+/).map((v) => v.trim()).filter(Boolean);
}

function candidateKey(sourceUrl: string, candidate: UrlImportCandidate, index: number) {
  return `${sourceUrl}::${candidate.playlist_index ?? index}::${candidate.id ?? "no-id"}::${candidate.url}`;
}

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
