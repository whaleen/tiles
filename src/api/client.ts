import { invoke } from "@tauri-apps/api/core";

// Media base URL — initialized once at startup via initMediaBase()
let _mediaBase = "";

export async function initMediaBase(): Promise<void> {
  const port = await invoke<number>("media_port");
  _mediaBase = `http://127.0.0.1:${port}`;
}

export function getMediaBase(): string {
  return _mediaBase;
}

// Generic invoke wrappers (for any hooks that need them directly)
export async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args);
}

export type FeedbackKind = "bug" | "feature" | "ui" | "chore" | "question" | "other";
export type FeedbackStatus = "new" | "planned" | "accepted" | "in_progress" | "done" | "wontfix";

export type FeedbackComment = {
  id: string;
  from: "user" | "agent";
  body: string;
  createdAt: string;
};

export type FeedbackRecord = {
  id: string;
  kind: FeedbackKind;
  status: FeedbackStatus;
  title?: string | null;
  body: string;
  plan?: string | null;
  comments?: FeedbackComment[];
  app: string;
  environment: string;
  route?: string | null;
  url?: string | null;
  context?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  createdBy?: string | null;
  agentNotes?: unknown[];
  linkedIssue?: string | null;
};

type SubmitFeedbackInput = {
  kind: FeedbackKind;
  title?: string | null;
  body: string;
  app?: string;
  environment?: string;
  route?: string;
  url?: string;
  context?: Record<string, unknown>;
  createdAt?: string;
  createdBy?: string | null;
};

export type UpdateFeedbackInput = {
  id: string;
  kind: FeedbackKind;
  title?: string | null;
  body: string;
  plan?: string | null;
  status?: FeedbackStatus;
};

export type SubmitFeedbackResponse = {
  id: string;
  path: string;
};

export async function submitFeedback(input: SubmitFeedbackInput): Promise<SubmitFeedbackResponse> {
  return invoke<SubmitFeedbackResponse>("submit_feedback", { input });
}

export async function listFeedback(): Promise<FeedbackRecord[]> {
  return invoke<FeedbackRecord[]>("list_feedback");
}

export async function updateFeedbackStatus(id: string, status: FeedbackStatus): Promise<void> {
  return invoke<void>("update_feedback_status", {
    input: { id, status, updatedAt: new Date().toISOString() },
  });
}

export async function updateFeedback(input: UpdateFeedbackInput): Promise<void> {
  return invoke<void>("update_feedback", {
    input: { ...input, updatedAt: new Date().toISOString() },
  });
}

export async function deleteFeedback(id: string): Promise<void> {
  return invoke<void>("delete_feedback", { id });
}

export async function addFeedbackComment(
  id: string,
  from: "user" | "agent",
  body: string
): Promise<void> {
  return invoke<void>("add_feedback_comment", {
    input: { id, from, body, createdAt: new Date().toISOString() },
  });
}

export async function clearFeedbackComments(id: string): Promise<void> {
  return invoke<void>("clear_feedback_comments", {
    id,
    updatedAt: new Date().toISOString(),
  });
}

let mediaCacheBuster = 0;

export function bumpMediaCache() {
  mediaCacheBuster = Date.now();
}

function withCache(url: string): string {
  return mediaCacheBuster ? `${url}?v=${mediaCacheBuster}` : url;
}

function encodePath(relPath: string): string {
  return relPath.split("/").map(encodeURIComponent).join("/");
}

export function thumbUrl(relPath: string): string {
  return withCache(`${_mediaBase}/thumbs/${encodePath(relPath)}`);
}

export function videoUrl(relPath: string): string {
  // Use the custom streamfile:// protocol instead of HTTP.
  // In production, Tauri serves pages from tauri://localhost (a secure context).
  // WKWebView blocks video/audio loaded over plain HTTP as mixed content,
  // while images (<img>) get through. The custom scheme is same-origin with
  // tauri:// and has no mixed-content restrictions.
  return withCache(`streamfile://localhost/${encodePath(relPath)}`);
}

export function previewVideoUrl(relPath: string): string {
  // Timeline playback preview uses the embedded HTTP media server.
  return withCache(`${_mediaBase}/files/${encodePath(relPath)}`);
}

export function frameUrl(relPath: string, seconds: number): string {
  const tenth = Math.max(0, Math.round(seconds * 10) / 10);
  return withCache(`${_mediaBase}/frames/${encodePath(relPath)}?t=${tenth.toFixed(1)}`);
}

export function filmstripUrl(relPath: string): string {
  // Scrub filmstrip sprite served by the embedded HTTP media server (an image,
  // so http is fine in WKWebView — unlike <video>).
  return withCache(`${_mediaBase}/filmstrips/${encodePath(relPath)}`);
}

export function outThumbUrl(relPath: string): string {
  return withCache(`${_mediaBase}/outthumbs/${encodePath(relPath)}`);
}

export function outVideoUrl(relPath: string): string {
  return withCache(`${_mediaBase}/outfiles/${encodePath(relPath)}`);
}
