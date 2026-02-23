const BASE = "";

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function apiGetText(path: string): Promise<string> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${path} failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function apiPostNoContent(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${path} failed: ${res.status} ${res.statusText}`);
  }
}

export async function apiPut(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`PUT ${path} failed: ${res.status} ${res.statusText}`);
  }
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(`DELETE ${path} failed: ${res.status} ${res.statusText}`);
  }
}

let mediaCacheBuster = 0;

export function bumpMediaCache() {
  mediaCacheBuster = Date.now();
}

function withMediaCache(path: string): string {
  return mediaCacheBuster ? `${path}?v=${mediaCacheBuster}` : path;
}

export function thumbUrl(relPath: string): string {
  return withMediaCache(
    `/api/media/thumbs/${encodeURIComponent(relPath).replace(/%2F/g, "/")}`
  );
}

export function videoUrl(relPath: string): string {
  return withMediaCache(
    `/api/media/files/${encodeURIComponent(relPath).replace(/%2F/g, "/")}`
  );
}

export function outThumbUrl(relPath: string): string {
  return withMediaCache(
    `/api/media/outthumbs/${encodeURIComponent(relPath).replace(/%2F/g, "/")}`
  );
}

export function outVideoUrl(relPath: string): string {
  return withMediaCache(
    `/api/media/outfiles/${encodeURIComponent(relPath).replace(/%2F/g, "/")}`
  );
}
