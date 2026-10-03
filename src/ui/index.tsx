// TermFleet UI primitives (design step 1.4). Styling lives in ./ui.css; this file
// only composes class names and owns behaviour (focus trap, Esc, aria wiring).
// Only what the 12 mocked surfaces need: no variants beyond the approved ones.

import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { AGENT_STATE_LABEL, type AgentState } from "../lib/agentState";
import "./ui.css";

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

export { Tooltip, TooltipHost } from "./Tooltip";

/* ---- Button -------------------------------------------------------------- */
export type ButtonSize = "sm" | "md" | "lg";
export type ButtonVariant = "default" | "outlined" | "primary" | "warn";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: ButtonSize;
  variant?: ButtonVariant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { size = "md", variant = "default", className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx("tf-btn", `tf-btn--${size}`, variant !== "default" && `tf-btn--${variant}`, className)}
      {...rest}
    />
  );
});

/* ---- IconButton (aria-label required) ------------------------------------ */
export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  "aria-label": string;
  size?: "sm" | "md";
  /** Close / remove icons use the failed colour. */
  danger?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = "sm", danger, className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx("tf-icon-btn", `tf-icon-btn--${size}`, danger && "tf-icon-btn--danger", className)}
      {...rest}
    />
  );
});

/* ---- Chip ---------------------------------------------------------------- */
export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  height?: 20 | 22;
  active?: boolean;
}

export function Chip({ height = 22, active, className, ...rest }: ChipProps) {
  return <span className={cx("tf-chip", `tf-chip--${height}`, className)} data-active={active ? "true" : undefined} {...rest} />;
}

/* ---- Status glyph + pill ------------------------------------------------- */
export type { AgentState };
export { AGENT_STATE_LABEL };

export function StatusDot({ state, className }: { state: AgentState; className?: string }) {
  return <span aria-hidden="true" className={cx("tf-status-dot", `tf-status-dot--${state}`, className)} />;
}

/** Glyph + word + colour, never colour alone. `label` overrides the default word. */
export function StatusPill({ state, label, className }: { state: AgentState; label?: string; className?: string }) {
  return (
    <span className={cx("tf-pill", `tf-pill--${state}`, className)} data-state={state}>
      <StatusDot state={state} />
      {label ?? AGENT_STATE_LABEL[state]}
    </span>
  );
}

/* ---- Kbd + SectionLabel -------------------------------------------------- */
export function Kbd({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <kbd className={cx("tf-kbd", className)} {...rest} />;
}

export function SectionLabel({ as: Tag = "span", className, ...rest }: HTMLAttributes<HTMLElement> & { as?: "span" | "h2" | "h3" }) {
  return <Tag className={cx("tf-section-label", className)} {...rest} />;
}

/* ---- ListRow ------------------------------------------------------------- */
export interface ListRowProps extends HTMLAttributes<HTMLDivElement> {
  selected?: boolean;
  /** Reserved, always-mounted slot revealed on hover/focus (no layout shift). */
  actions?: ReactNode;
}

export const ListRow = forwardRef<HTMLDivElement, ListRowProps>(function ListRow(
  { selected, actions, className, children, role = "button", tabIndex = 0, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      role={role}
      tabIndex={tabIndex}
      aria-current={selected ? "true" : undefined}
      data-selected={selected ? "true" : "false"}
      className={cx("tf-row", className)}
      {...rest}
    >
      {children}
      {actions ? <span className="tf-row__actions">{actions}</span> : null}
    </div>
  );
});

/* ---- Field --------------------------------------------------------------- */
export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: 28 | 30 | 32;
  mono?: boolean;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { size = 28, mono, className, ...rest },
  ref,
) {
  return <input ref={ref} className={cx("tf-field", `tf-field--${size}`, mono && "tf-field--mono", className)} {...rest} />;
});

/* ---- Menu ---------------------------------------------------------------- */
export function Menu({ className, role = "menu", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div role={role} className={cx("tf-menu", className)} {...rest} />;
}

export interface MenuItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  danger?: boolean;
}

export const MenuItem = forwardRef<HTMLButtonElement, MenuItemProps>(function MenuItem(
  { danger, className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      role="menuitem"
      className={cx("tf-menu__item", danger && "tf-menu__item--danger", className)}
      {...rest}
    />
  );
});

/* ---- Checkbox ------------------------------------------------------------ */
export const Checkbox = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type">>(
  function Checkbox({ className, ...rest }, ref) {
    return <input ref={ref} type="checkbox" className={cx("tf-checkbox", className)} {...rest} />;
  },
);

/* ---- Dialog -------------------------------------------------------------- */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  title: ReactNode;
  onClose: () => void;
  /** Panel width in px (approve 560, folder picker 640). */
  width?: number;
  /** Optional fixed height in px. */
  height?: number;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
  "data-testid"?: string;
}

/**
 * Scrim + container. Esc closes, Tab is trapped inside, focus moves in on open and
 * returns to the previously focused element on close. role=dialog + aria-modal +
 * aria-labelledby.
 */
export function Dialog({ title, onClose, width = 560, height, footer, children, className, ...rest }: DialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    if (panel) {
      // [data-autofocus] marks the control that should receive focus on open.
      const first = panel.querySelector<HTMLElement>("[data-autofocus]") ?? panel.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel).focus();
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previous?.focus?.();
    };
  }, []);

  return createPortal(
    <div
      className="tf-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx("tf-dialog", className)}
        style={{ width, height }}
        {...rest}
      >
        <div className="tf-dialog__header">
          <h2 id={titleId} className="tf-dialog__title">
            {title}
          </h2>
          <IconButton aria-label="Close" size="sm" onClick={() => onCloseRef.current()}>
            <X size={13} strokeWidth={1.8} aria-hidden="true" />
          </IconButton>
        </div>
        {children}
        {footer ? <div className="tf-dialog__footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
