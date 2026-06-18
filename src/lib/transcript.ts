/**
 * Transcript parsing for the in-app viewer.
 *
 * Supported formats (produced by the `transcribe` action via whisper-cli, or
 * imported alongside videos):
 *
 * - **json** — whisper.cpp `--output-json` shape:
 *     { "transcription": [ { "offsets": { "from": <ms>, "to": <ms> },
 *                            "timestamps": { "from": "HH:MM:SS,mmm", ... },
 *                            "text": " ..." }, ... ] }
 *   Also accepts a generic `{ "segments": [ { "start": <s>, "end": <s>,
 *   "text": "..." } ] }` shape (seconds) for robustness.
 * - **vtt** — WebVTT cues: `HH:MM:SS.mmm --> HH:MM:SS.mmm`.
 * - **srt** — SubRip cues: `HH:MM:SS,mmm --> HH:MM:SS,mmm`.
 * - **txt** — plain text, no timestamps (single, non-seekable segment).
 *
 * JSON is the recommended format because it gives the richest, per-segment
 * timestamps for click-to-seek and is the most stable for future agent use.
 */

export interface TranscriptSegment {
  /** Segment start in seconds. */
  start: number;
  /** Segment end in seconds, or null when unknown (e.g. plain text). */
  end: number | null;
  text: string;
}

/** Whether a transcript of this format carries per-segment timestamps. */
export function isSeekableFormat(format: string): boolean {
  return format === "json" || format === "vtt" || format === "srt";
}

export function parseTranscript(format: string, content: string): TranscriptSegment[] {
  switch (format) {
    case "json":
      return parseWhisperJson(content);
    case "vtt":
    case "srt":
      return parseCues(content);
    default:
      return parseText(content);
  }
}

function parseWhisperJson(content: string): TranscriptSegment[] {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return [];
  }
  if (!data || typeof data !== "object") return [];
  const obj = data as Record<string, unknown>;

  // whisper.cpp --output-json
  if (Array.isArray(obj.transcription)) {
    return obj.transcription
      .map((raw): TranscriptSegment => {
        const seg = raw as { offsets?: { from?: number; to?: number }; text?: string };
        const fromMs = Number(seg.offsets?.from);
        const toMs = Number(seg.offsets?.to);
        return {
          start: Number.isFinite(fromMs) ? fromMs / 1000 : 0,
          end: Number.isFinite(toMs) ? toMs / 1000 : null,
          text: (seg.text ?? "").trim(),
        };
      })
      .filter((s) => s.text.length > 0);
  }

  // Generic { segments: [{ start, end, text }] } in seconds
  if (Array.isArray(obj.segments)) {
    return obj.segments
      .map((raw): TranscriptSegment => {
        const seg = raw as { start?: number; end?: number; text?: string };
        const start = Number(seg.start);
        const end = Number(seg.end);
        return {
          start: Number.isFinite(start) ? start : 0,
          end: Number.isFinite(end) ? end : null,
          text: (seg.text ?? "").trim(),
        };
      })
      .filter((s) => s.text.length > 0);
  }

  return [];
}

// Matches both VTT (`.` ms separator) and SRT (`,` ms separator) cue lines.
const CUE = /(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/;

function toSeconds(h: string, m: string, s: string, ms: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

function parseCues(content: string): TranscriptSegment[] {
  const lines = content.replace(/\r/g, "").split("\n");
  const segments: TranscriptSegment[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = CUE.exec(lines[i]);
    if (!m) {
      i += 1;
      continue;
    }
    const start = toSeconds(m[1], m[2], m[3], m[4]);
    const end = toSeconds(m[5], m[6], m[7], m[8]);
    i += 1;
    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !CUE.test(lines[i])) {
      textLines.push(lines[i].trim());
      i += 1;
    }
    const text = textLines.join(" ").trim();
    if (text) segments.push({ start, end, text });
  }
  return segments;
}

function parseText(content: string): TranscriptSegment[] {
  const text = content.trim();
  return text ? [{ start: 0, end: null, text }] : [];
}
