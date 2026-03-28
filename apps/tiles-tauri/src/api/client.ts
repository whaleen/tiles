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
  return withCache(`${_mediaBase}/files/${encodePath(relPath)}`);
}

export function outThumbUrl(relPath: string): string {
  return withCache(`${_mediaBase}/outthumbs/${encodePath(relPath)}`);
}

export function outVideoUrl(relPath: string): string {
  return withCache(`${_mediaBase}/outfiles/${encodePath(relPath)}`);
}
