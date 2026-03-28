import { useCallback, useRef, useState } from "react";

interface CropOverlayProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
  videoWidth: number;
  videoHeight: number;
  onCropChange: (x: number, y: number, w: number, h: number) => void;
}

export function CropOverlay({
  videoRef,
  cropX,
  cropY,
  cropW,
  cropH,
  videoWidth,
  videoHeight,
  onCropChange,
}: CropOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<
    null | "move" | "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w"
  >(null);
  const dragStart = useRef({ mx: 0, my: 0, cx: 0, cy: 0, cw: 0, ch: 0 });

  // Calculate scale factor: video pixels → display pixels
  const getScale = useCallback(() => {
    const video = videoRef.current;
    const container = containerRef.current;
    if (!video || !container || videoWidth === 0 || videoHeight === 0) {
      return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
    }

    const rect = container.getBoundingClientRect();
    const displayW = rect.width;
    const displayH = rect.height;

    // Account for object-fit: contain (letterboxing)
    const videoAspect = videoWidth / videoHeight;
    const containerAspect = displayW / displayH;

    let renderW: number, renderH: number, offsetX: number, offsetY: number;
    if (videoAspect > containerAspect) {
      // Wider than container — pillarbox
      renderW = displayW;
      renderH = displayW / videoAspect;
      offsetX = 0;
      offsetY = (displayH - renderH) / 2;
    } else {
      // Taller than container — letterbox
      renderH = displayH;
      renderW = displayH * videoAspect;
      offsetX = (displayW - renderW) / 2;
      offsetY = 0;
    }

    return {
      scaleX: renderW / videoWidth,
      scaleY: renderH / videoHeight,
      offsetX,
      offsetY,
    };
  }, [videoRef, videoWidth, videoHeight]);

  // Convert native crop coords to display pixels
  const toDisplay = useCallback(
    (nx: number, ny: number, nw: number, nh: number) => {
      const { scaleX, scaleY, offsetX, offsetY } = getScale();
      return {
        left: offsetX + nx * scaleX,
        top: offsetY + ny * scaleY,
        width: nw * scaleX,
        height: nh * scaleY,
      };
    },
    [getScale]
  );

  // Convert display delta to native delta
  const toNativeDelta = useCallback(
    (dx: number, dy: number) => {
      const { scaleX, scaleY } = getScale();
      return { dx: dx / scaleX, dy: dy / scaleY };
    },
    [getScale]
  );

  const clamp = (val: number, min: number, max: number) =>
    Math.max(min, Math.min(max, val));

  const handlePointerDown = useCallback(
    (
      e: React.PointerEvent,
      handle:
        | "move"
        | "nw"
        | "ne"
        | "sw"
        | "se"
        | "n"
        | "s"
        | "e"
        | "w"
    ) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(handle);
      dragStart.current = {
        mx: e.clientX,
        my: e.clientY,
        cx: cropX,
        cy: cropY,
        cw: cropW,
        ch: cropH,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [cropX, cropY, cropW, cropH]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      const { mx, my, cx, cy, cw, ch } = dragStart.current;
      const rawDx = e.clientX - mx;
      const rawDy = e.clientY - my;
      const { dx, dy } = toNativeDelta(rawDx, rawDy);

      const MIN_SIZE = 16;

      if (dragging === "move") {
        const nx = clamp(Math.round(cx + dx), 0, videoWidth - cw);
        const ny = clamp(Math.round(cy + dy), 0, videoHeight - ch);
        onCropChange(nx, ny, cw, ch);
        return;
      }

      let newX = cx;
      let newY = cy;
      let newW = cw;
      let newH = ch;

      // Horizontal resize
      if (dragging.includes("w")) {
        // Left edge
        const maxLeftMove = cw - MIN_SIZE;
        const leftDx = clamp(Math.round(dx), -cx, maxLeftMove);
        newX = cx + leftDx;
        newW = cw - leftDx;
      }
      if (dragging.includes("e") && !dragging.includes("w")) {
        // Right edge — "e", "ne", "se"
        newW = clamp(Math.round(cw + dx), MIN_SIZE, videoWidth - cx);
      }

      // Vertical resize
      if (dragging === "n" || dragging === "nw" || dragging === "ne") {
        const maxTopMove = ch - MIN_SIZE;
        const topDy = clamp(Math.round(dy), -cy, maxTopMove);
        newY = cy + topDy;
        newH = ch - topDy;
      }
      if (dragging === "s" || dragging === "sw" || dragging === "se") {
        newH = clamp(Math.round(ch + dy), MIN_SIZE, videoHeight - cy);
      }

      // Keep within bounds
      newX = clamp(newX, 0, videoWidth - MIN_SIZE);
      newY = clamp(newY, 0, videoHeight - MIN_SIZE);
      newW = clamp(newW, MIN_SIZE, videoWidth - newX);
      newH = clamp(newH, MIN_SIZE, videoHeight - newY);

      onCropChange(newX, newY, newW, newH);
    },
    [dragging, toNativeDelta, videoWidth, videoHeight, onCropChange]
  );

  const handlePointerUp = useCallback(() => {
    setDragging(null);
  }, []);

  const display = toDisplay(cropX, cropY, cropW, cropH);

  const handleSize = 8;
  const handleClass =
    "absolute bg-white border border-primary rounded-sm pointer-events-auto";

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 10 }}
    >
      {/* Dark mask — four rectangles around the crop hole */}
      <div
        className="absolute bg-black/50"
        style={{ top: 0, left: 0, right: 0, height: display.top }}
      />
      <div
        className="absolute bg-black/50"
        style={{
          top: display.top + display.height,
          left: 0,
          right: 0,
          bottom: 0,
        }}
      />
      <div
        className="absolute bg-black/50"
        style={{
          top: display.top,
          left: 0,
          width: display.left,
          height: display.height,
        }}
      />
      <div
        className="absolute bg-black/50"
        style={{
          top: display.top,
          left: display.left + display.width,
          right: 0,
          height: display.height,
        }}
      />

      {/* Crop region — draggable */}
      <div
        className="absolute border-2 border-white/80 pointer-events-auto cursor-move"
        style={{
          left: display.left,
          top: display.top,
          width: display.width,
          height: display.height,
        }}
        onPointerDown={(e) => handlePointerDown(e, "move")}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Corner handles */}
        <div
          className={handleClass}
          style={{
            top: -handleSize / 2,
            left: -handleSize / 2,
            width: handleSize,
            height: handleSize,
            cursor: "nw-resize",
          }}
          onPointerDown={(e) => handlePointerDown(e, "nw")}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
        <div
          className={handleClass}
          style={{
            top: -handleSize / 2,
            right: -handleSize / 2,
            width: handleSize,
            height: handleSize,
            cursor: "ne-resize",
          }}
          onPointerDown={(e) => handlePointerDown(e, "ne")}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
        <div
          className={handleClass}
          style={{
            bottom: -handleSize / 2,
            left: -handleSize / 2,
            width: handleSize,
            height: handleSize,
            cursor: "sw-resize",
          }}
          onPointerDown={(e) => handlePointerDown(e, "sw")}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
        <div
          className={handleClass}
          style={{
            bottom: -handleSize / 2,
            right: -handleSize / 2,
            width: handleSize,
            height: handleSize,
            cursor: "se-resize",
          }}
          onPointerDown={(e) => handlePointerDown(e, "se")}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
        {/* Edge handles */}
        <div
          className={handleClass}
          style={{
            top: -handleSize / 2,
            left: "50%",
            marginLeft: -handleSize / 2,
            width: handleSize,
            height: handleSize,
            cursor: "n-resize",
          }}
          onPointerDown={(e) => handlePointerDown(e, "n")}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
        <div
          className={handleClass}
          style={{
            bottom: -handleSize / 2,
            left: "50%",
            marginLeft: -handleSize / 2,
            width: handleSize,
            height: handleSize,
            cursor: "s-resize",
          }}
          onPointerDown={(e) => handlePointerDown(e, "s")}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
        <div
          className={handleClass}
          style={{
            top: "50%",
            left: -handleSize / 2,
            marginTop: -handleSize / 2,
            width: handleSize,
            height: handleSize,
            cursor: "w-resize",
          }}
          onPointerDown={(e) => handlePointerDown(e, "w")}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
        <div
          className={handleClass}
          style={{
            top: "50%",
            right: -handleSize / 2,
            marginTop: -handleSize / 2,
            width: handleSize,
            height: handleSize,
            cursor: "e-resize",
          }}
          onPointerDown={(e) => handlePointerDown(e, "e")}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
      </div>
    </div>
  );
}
