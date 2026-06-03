import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { X } from "lucide-react";

export interface FullscreenVideoState {
  currentTime: number;
  paused: boolean;
  volume: number;
  muted: boolean;
  playbackRate: number;
}

export interface FullscreenVideoOptions extends Partial<FullscreenVideoState> {
  src: string;
  title?: string;
  onClose?: (state: FullscreenVideoState) => void;
}

interface FullscreenVideoContextValue {
  openVideoFullscreen: (options: FullscreenVideoOptions) => void;
  isVideoFullscreenOpen: boolean;
}

const FullscreenVideoContext = createContext<FullscreenVideoContextValue | null>(null);

export function FullscreenVideoProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<FullscreenVideoOptions | null>(null);
  const [enteredWindowFullscreen, setEnteredWindowFullscreen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fallbackRef = useRef<HTMLDivElement>(null);

  const openVideoFullscreen = useCallback((options: FullscreenVideoOptions) => {
    setActive(options);
  }, []);

  const readVideoState = useCallback((): FullscreenVideoState => {
    const el = videoRef.current;
    return {
      currentTime: el?.currentTime ?? active?.currentTime ?? 0,
      paused: el?.paused ?? active?.paused ?? true,
      volume: el?.volume ?? active?.volume ?? 1,
      muted: el?.muted ?? active?.muted ?? false,
      playbackRate: el?.playbackRate ?? active?.playbackRate ?? 1,
    };
  }, [active]);

  const close = useCallback(() => {
    const state = readVideoState();
    active?.onClose?.(state);
    setActive(null);

    if (enteredWindowFullscreen) {
      void getCurrentWindow().setFullscreen(false).catch(() => {});
      setEnteredWindowFullscreen(false);
    } else if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
  }, [active, enteredWindowFullscreen, readVideoState]);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    void getCurrentWindow()
      .setFullscreen(true)
      .then(() => {
        if (!cancelled) setEnteredWindowFullscreen(true);
      })
      .catch(() => {
        // Browser/dev fallback. The user gesture happened on the caller's button;
        // some browsers may still deny this, but Tauri is the primary path.
        void fallbackRef.current?.requestFullscreen?.().catch(() => {});
      });

    return () => {
      cancelled = true;
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" || event.key === "f" || event.key === "F") {
        event.preventDefault();
        close();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, close]);

  return (
    <FullscreenVideoContext.Provider value={{ openVideoFullscreen, isVideoFullscreenOpen: active !== null }}>
      {children}
      {active && (
        <div
          ref={fallbackRef}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black"
          role="dialog"
          aria-modal="true"
          aria-label={active.title ? `Fullscreen video: ${active.title}` : "Fullscreen video"}
        >
          <video
            ref={videoRef}
            src={active.src}
            controls
            autoPlay={!active.paused}
            className="h-full w-full object-contain"
            onLoadedMetadata={(event) => {
              const el = event.currentTarget;
              if (active.currentTime && Number.isFinite(active.currentTime)) {
                el.currentTime = active.currentTime;
              }
              el.volume = active.volume ?? 1;
              el.muted = active.muted ?? false;
              el.playbackRate = active.playbackRate ?? 1;
              if (!active.paused) void el.play().catch(() => {});
            }}
          />
          <button
            type="button"
            onClick={close}
            className="absolute right-4 top-4 rounded-full bg-black/70 p-2 text-white shadow-lg transition-colors hover:bg-black/90"
            aria-label="Exit fullscreen"
          >
            <X className="h-5 w-5" />
          </button>
          {active.title && (
            <div className="pointer-events-none absolute left-4 top-4 max-w-[70vw] truncate rounded bg-black/60 px-3 py-1 text-sm text-white">
              {active.title}
            </div>
          )}
        </div>
      )}
    </FullscreenVideoContext.Provider>
  );
}

export function useFullscreenVideo() {
  const context = useContext(FullscreenVideoContext);
  if (!context) {
    throw new Error("useFullscreenVideo must be used inside FullscreenVideoProvider");
  }
  return context;
}

export function readFullscreenState(el: HTMLVideoElement | null): FullscreenVideoState {
  return {
    currentTime: el?.currentTime ?? 0,
    paused: el?.paused ?? true,
    volume: el?.volume ?? 1,
    muted: el?.muted ?? false,
    playbackRate: el?.playbackRate ?? 1,
  };
}
