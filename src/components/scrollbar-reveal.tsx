"use client";

import { useEffect } from "react";

/*
 * Scrollbars stay out of sight (globals.css) until they're wanted: the pointer comes within reach
 * of one, it's being dragged, or its area is scrolling. Whichever is showing gets .scrollbar-shown.
 */

/** How close the pointer has to come to a scrollbar's edge, in pixels. */
const NEAR = 24;
/** How long a scrollbar stays in sight after its area stops scrolling. */
const AFTER_SCROLL_MS = 900;

function scrolls(el: Element, axis: "y" | "x"): boolean {
  const s = getComputedStyle(el);
  const overflow = axis === "y" ? s.overflowY : s.overflowX;
  if (!/(auto|scroll)/.test(overflow)) return false;
  return axis === "y" ? el.scrollHeight > el.clientHeight + 1 : el.scrollWidth > el.clientWidth + 1;
}

/** The scrolling area whose scrollbar the pointer is near: the innermost one, else the page's. */
function nearScrollbar(target: Element | null, x: number, y: number): Element | null {
  for (let el = target; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    const r = el.getBoundingClientRect();
    if (x <= r.right && r.right - x <= NEAR && scrolls(el, "y")) return el;
    if (y <= r.bottom && r.bottom - y <= NEAR && scrolls(el, "x")) return el;
  }
  const page = document.documentElement;
  const tallPage = page.scrollHeight > window.innerHeight + 1 && getComputedStyle(page).overflowY !== "hidden";
  return tallPage && window.innerWidth - x <= NEAR ? page : null;
}

export function ScrollbarReveal() {
  useEffect(() => {
    let near: Element | null = null;
    let dragging = false;
    let frame = 0;
    const scrolling = new Map<Element, ReturnType<typeof setTimeout>>();

    const setNear = (el: Element | null) => {
      if (el === near) return;
      if (near && !scrolling.has(near)) near.classList.remove("scrollbar-shown");
      near = el;
      near?.classList.add("scrollbar-shown");
    };

    const onMove = (e: PointerEvent) => {
      if (dragging || e.pointerType === "touch") return;
      const { target, clientX, clientY } = e;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setNear(nearScrollbar(target as Element | null, clientX, clientY)));
    };
    // A press on a scrollbar keeps it in sight until it's let go, wherever the pointer goes.
    const onDown = (e: PointerEvent) => {
      if (near && e.pointerType !== "touch") dragging = true;
    };
    const onUp = () => {
      dragging = false;
    };
    const onLeave = () => {
      if (!dragging) setNear(null);
    };
    const onScroll = (e: Event) => {
      const el = e.target === document ? document.documentElement : (e.target as Element);
      if (!(el instanceof Element)) return;
      el.classList.add("scrollbar-shown");
      clearTimeout(scrolling.get(el));
      scrolling.set(
        el,
        setTimeout(() => {
          scrolling.delete(el);
          if (el !== near) el.classList.remove("scrollbar-shown");
        }, AFTER_SCROLL_MS),
      );
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    window.addEventListener("dragend", onUp, true);
    window.addEventListener("blur", onUp);
    document.documentElement.addEventListener("pointerleave", onLeave);
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scrolling.forEach((t) => clearTimeout(t));
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      window.removeEventListener("dragend", onUp, true);
      window.removeEventListener("blur", onUp);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, []);
  return null;
}
