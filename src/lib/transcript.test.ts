import { describe, it, expect } from "vitest";
import { parseTranscript, isSeekableFormat } from "@/lib/transcript";

describe("isSeekableFormat", () => {
  it("treats timestamped formats as seekable", () => {
    expect(isSeekableFormat("json")).toBe(true);
    expect(isSeekableFormat("vtt")).toBe(true);
    expect(isSeekableFormat("srt")).toBe(true);
    expect(isSeekableFormat("txt")).toBe(false);
  });
});

describe("parseTranscript — whisper.cpp JSON", () => {
  const json = JSON.stringify({
    transcription: [
      { offsets: { from: 0, to: 1500 }, text: " Hello world" },
      { offsets: { from: 1500, to: 3200 }, text: " second line " },
      { offsets: { from: 3200, to: 4000 }, text: "  " }, // blank → dropped
    ],
  });

  it("converts ms offsets to seconds and trims text", () => {
    const segs = parseTranscript("json", json);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toEqual({ start: 0, end: 1.5, text: "Hello world" });
    expect(segs[1]).toEqual({ start: 1.5, end: 3.2, text: "second line" });
  });

  it("supports a generic { segments } shape in seconds", () => {
    const generic = JSON.stringify({
      segments: [{ start: 2, end: 4, text: "hi" }],
    });
    expect(parseTranscript("json", generic)).toEqual([{ start: 2, end: 4, text: "hi" }]);
  });

  it("returns [] for malformed JSON instead of throwing", () => {
    expect(parseTranscript("json", "{not json")).toEqual([]);
    expect(parseTranscript("json", "[]")).toEqual([]);
  });
});

describe("parseTranscript — VTT / SRT cues", () => {
  it("parses WebVTT cues", () => {
    const vtt = [
      "WEBVTT",
      "",
      "00:00:00.000 --> 00:00:02.500",
      "Hello there",
      "",
      "00:00:02.500 --> 00:00:05.000",
      "general kenobi",
      "",
    ].join("\n");
    const segs = parseTranscript("vtt", vtt);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toEqual({ start: 0, end: 2.5, text: "Hello there" });
    expect(segs[1].start).toBeCloseTo(2.5);
  });

  it("parses SRT cues (comma ms separator, numeric indices skipped)", () => {
    const srt = [
      "1",
      "00:00:01,000 --> 00:00:03,000",
      "first",
      "",
      "2",
      "00:01:00,000 --> 00:01:02,000",
      "later",
      "",
    ].join("\n");
    const segs = parseTranscript("srt", srt);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toEqual({ start: 1, end: 3, text: "first" });
    expect(segs[1].start).toBeCloseTo(60);
  });

  it("joins multi-line cue text", () => {
    const vtt = "00:00:00.000 --> 00:00:01.000\nline one\nline two\n";
    expect(parseTranscript("vtt", vtt)[0].text).toBe("line one line two");
  });
});

describe("parseTranscript — plain text", () => {
  it("returns a single non-seekable segment", () => {
    const segs = parseTranscript("txt", "  just some words  ");
    expect(segs).toEqual([{ start: 0, end: null, text: "just some words" }]);
  });

  it("returns [] for empty content", () => {
    expect(parseTranscript("txt", "   ")).toEqual([]);
  });
});
