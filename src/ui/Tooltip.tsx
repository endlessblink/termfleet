// Tooltip primitive (design step 3.4).
//
//  * <Tooltip content="…"> wraps one element and tags it with data-tooltip.
//  * <TooltipHost/> (mounted once in App) shows ONE tooltip for whichever element
//    has data-tooltip: 400ms delay the first time, 0 while "warm" (a tooltip was
//    visible a moment ago), role="tooltip", aria-describedby on the trigger,
//    Esc/blur/leave hides it, --z-tooltip.
//  * Icon-only buttons that still carry a native title= (the surfaces were built
//    on title attributes) are upgraded automatically: their title moves to
//    data-tooltip and aria-label is filled from it when missing, so every
//    icon-only control has an accessible name AND a real tooltip. Buttons with
//    visible text keep their native title untouched.

import { cloneElement, useEffect, useId, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";

const DELAY_MS = 400;
const WARM_MS = 600;
const ICON_ONLY_SELECTOR = "button[title], [role='button'][title]";

export function Tooltip({ content, children }: { content: string; children: ReactElement<Record<string, unknown>> }) {
  return cloneElement(children, { "data-tooltip": content });
}

function isIconOnly(el: HTMLElement): boolean {
  return (el.textContent ?? "").trim().length === 0;
}

/** Upgrade icon-only controls: title -> data-tooltip (+ aria-label when missing). */
export function upgradeIconButtons(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>(ICON_ONLY_SELECTOR).forEach((el) => {
    const title = el.getAttribute("title");
    if (!title || !isIconOnly(el)) return;
    el.setAttribute("data-tooltip", title);
    if (!el.hasAttribute("aria-label") && !el.hasAttribute("aria-labelledby")) el.setAttribute("aria-label", title);
    el.removeAttribute("title");
  });
}

interface Shown {
  text: string;
  x: number;
  y: number;
  placement: "above" | "below";
}

export function TooltipHost() {
  const id = useId();
  const [shown, setShown] = useState<Shown | null>(null);
  const timer = useRef<number | null>(null);
  const lastHiddenAt = useRef(0);
  const trigger = useRef<HTMLElement | null>(null);

  useEffect(() => {
    upgradeIconButtons(document);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes" && record.target instanceof HTMLElement) {
          const el = record.target;
          if (el.matches(ICON_ONLY_SELECTOR)) upgradeIconButtons(el.parentElement ?? document);
        } else {
          record.addedNodes.forEach((node) => {
            if (node instanceof HTMLElement) {
              if (node.matches(ICON_ONLY_SELECTOR)) upgradeIconButtons(node.parentElement ?? document);
              else upgradeIconButtons(node);
            }
          });
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["title"] });

    const clearTimer = () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
    const hide = () => {
      clearTimer();
      if (trigger.current) trigger.current.removeAttribute("aria-describedby");
      trigger.current = null;
      setShown((current) => {
        if (current) lastHiddenAt.current = Date.now();
        return null;
      });
    };
    const show = (el: HTMLElement) => {
      const text = el.getAttribute("data-tooltip");
      if (!text) return;
      const rect = el.getBoundingClientRect();
      const below = rect.top < 40;
      trigger.current = el;
      el.setAttribute("aria-describedby", id);
      setShown({ text, x: rect.left + rect.width / 2, y: below ? rect.bottom + 6 : rect.top - 6, placement: below ? "below" : "above" });
    };
    const schedule = (el: HTMLElement) => {
      clearTimer();
      const warm = Date.now() - lastHiddenAt.current < WARM_MS;
      if (warm) show(el);
      else timer.current = window.setTimeout(() => show(el), DELAY_MS);
    };
    const find = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>("[data-tooltip]") : null);

    const onOver = (event: PointerEvent) => {
      const el = find(event.target);
      if (el && el !== trigger.current) schedule(el);
    };
    const onOut = (event: PointerEvent) => {
      const el = find(event.target);
      if (el && !el.contains(event.relatedTarget as Node | null)) hide();
    };
    const onFocusIn = (event: FocusEvent) => {
      const el = find(event.target);
      if (el && el.matches(":focus-visible")) schedule(el);
    };
    const onFocusOut = () => hide();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    const onDown = () => hide();

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      observer.disconnect();
      clearTimer();
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [id]);

  if (!shown) return null;
  return createPortal(
    <div
      id={id}
      role="tooltip"
      className="tf-tooltip"
      style={{
        left: shown.x,
        top: shown.y,
        transform: shown.placement === "above" ? "translate(-50%, -100%)" : "translate(-50%, 0)",
      }}
    >
      {shown.text}
    </div>,
    document.body,
  );
}
