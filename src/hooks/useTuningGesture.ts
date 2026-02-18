"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRadioDialStore } from "@/stores/radio-dial-store";

const BASE_PX_TO_DAYS = 0.5; // 1px drag = 0.5 days at default zoom

interface GestureOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  totalDays: number;
  onYearClick?: (year: number) => void;
  yearLabelHitAreas?: { x: number; width: number; year: number }[];
}

export function useTuningGesture({
  canvasRef,
  totalDays,
  onYearClick,
  yearLabelHitAreas,
}: GestureOptions) {
  const tune = useRadioDialStore((s) => s.tune);
  const setPosition = useRadioDialStore((s) => s.setPosition);
  const setZoom = useRadioDialStore((s) => s.setZoom);

  // Drag state
  const dragging = useRef(false);
  const lastX = useRef(0);
  // Touch momentum
  const velocity = useRef(0);
  const momentumId = useRef<number | null>(null);

  const clamp = useCallback(
    (pos: number) => Math.max(0, Math.min(pos, totalDays)),
    [totalDays],
  );

  // Mouse handlers
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onMouseDown = (e: MouseEvent) => {
      // Check if clicking a year label
      if (yearLabelHitAreas && onYearClick) {
        const rect = canvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        // Year labels are in the bottom 20px area
        if (clickY > rect.height - 24) {
          for (const area of yearLabelHitAreas) {
            if (clickX >= area.x && clickX <= area.x + area.width) {
              onYearClick(area.year);
              return;
            }
          }
        }
      }

      dragging.current = true;
      lastX.current = e.clientX;
      canvas.style.cursor = "grabbing";
      if (momentumId.current) {
        cancelAnimationFrame(momentumId.current);
        momentumId.current = null;
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - lastX.current;
      lastX.current = e.clientX;
      const pxToDays = BASE_PX_TO_DAYS * (2 / (useRadioDialStore.getState().zoom || 2));
      tune(-dx * pxToDays);
      // Clamp
      const pos = useRadioDialStore.getState().position;
      if (pos < 0 || pos > totalDays) setPosition(clamp(pos));
    };

    const onMouseUp = () => {
      dragging.current = false;
      canvas.style.cursor = "grab";
    };

    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [canvasRef, tune, setPosition, setZoom, totalDays, clamp, onYearClick, yearLabelHitAreas]);

  // Touch handlers with momentum
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let touchId: number | null = null;
    let pinchStartDist = 0;
    let pinchStartZoom = 2;

    const onTouchStart = (e: TouchEvent) => {
      // Pinch-to-zoom with 2 fingers
      if (e.touches.length === 2) {
        dragging.current = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchStartDist = Math.hypot(dx, dy);
        pinchStartZoom = useRadioDialStore.getState().zoom;
        return;
      }

      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      touchId = touch.identifier;
      lastX.current = touch.clientX;
      velocity.current = 0;
      dragging.current = true;
      if (momentumId.current) {
        cancelAnimationFrame(momentumId.current);
        momentumId.current = null;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      // Handle pinch zoom
      if (e.touches.length === 2 && pinchStartDist > 0) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const scale = dist / pinchStartDist;
        setZoom(pinchStartZoom * scale);
        return;
      }

      if (!dragging.current || touchId === null) return;
      const touch = Array.from(e.changedTouches).find(
        (t) => t.identifier === touchId,
      );
      if (!touch) return;
      e.preventDefault();

      const dx = touch.clientX - lastX.current;
      lastX.current = touch.clientX;
      const pxToDays = BASE_PX_TO_DAYS * (2 / (useRadioDialStore.getState().zoom || 2));
      velocity.current = -dx * pxToDays;
      tune(-dx * pxToDays);
      const pos = useRadioDialStore.getState().position;
      if (pos < 0 || pos > totalDays) setPosition(clamp(pos));
    };

    const onTouchEnd = () => {
      dragging.current = false;
      touchId = null;

      // Apply momentum
      let v = velocity.current;
      const decay = 0.95;

      const step = () => {
        if (Math.abs(v) < 0.05) return;
        tune(v);
        const pos = useRadioDialStore.getState().position;
        if (pos < 0 || pos > totalDays) {
          setPosition(clamp(pos));
          return;
        }
        v *= decay;
        momentumId.current = requestAnimationFrame(step);
      };

      momentumId.current = requestAnimationFrame(step);
    };

    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);

    return () => {
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      if (momentumId.current) cancelAnimationFrame(momentumId.current);
    };
  }, [canvasRef, tune, setPosition, setZoom, totalDays, clamp]);

  // Scroll wheel
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Ctrl+wheel = zoom
      if (e.ctrlKey || e.metaKey) {
        const currentZoom = useRadioDialStore.getState().zoom;
        const delta = e.deltaY > 0 ? -0.3 : 0.3;
        setZoom(currentZoom + delta);
        return;
      }
      const days = e.shiftKey ? 30 : 1;
      const dir = e.deltaY > 0 ? 1 : -1;
      tune(dir * days);
      const pos = useRadioDialStore.getState().position;
      if (pos < 0 || pos > totalDays) setPosition(clamp(pos));
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [canvasRef, tune, setPosition, setZoom, totalDays, clamp]);

  return { dragging };
}
