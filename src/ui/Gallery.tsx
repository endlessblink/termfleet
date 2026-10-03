// Dev-only primitives gallery. Reached with  http://127.0.0.1:<port>/#ui-gallery
// (main.tsx loads this module only when import.meta.env.DEV and the hash match).

import { useState, type ReactNode } from "react";
import { Copy } from "lucide-react";
import {
  Button,
  Checkbox,
  Chip,
  Dialog,
  Field,
  IconButton,
  Kbd,
  ListRow,
  Menu,
  MenuItem,
  SectionLabel,
  StatusDot,
  StatusPill,
  type AgentState,
  type ButtonVariant,
} from "./index";
import "./gallery.css";

const ACCENTS = ["A", "B", "C"] as const;
const FORCED = ["rest", "hover", "active", "focus", "disabled"] as const;
const STATES: AgentState[] = ["running", "waiting", "idle", "failed", "done"];
const VARIANTS: ButtonVariant[] = ["default", "outlined", "primary", "warn"];

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="tf-gallery__cell">
      {children}
      <small>{label}</small>
    </div>
  );
}

function forceProps(state: (typeof FORCED)[number]) {
  if (state === "disabled") return { disabled: true } as const;
  if (state === "rest") return {} as const;
  return { "data-force": state } as const;
}

export default function Gallery() {
  const [accent, setAccent] = useState<(typeof ACCENTS)[number]>(
    (document.documentElement.getAttribute("data-accent") as (typeof ACCENTS)[number]) ?? "A",
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const setVariant = (value: (typeof ACCENTS)[number]) => {
    document.documentElement.setAttribute("data-accent", value);
    setAccent(value);
  };

  return (
    <div className="tf-gallery" data-testid="ui-gallery">
      <h1>TermFleet UI primitives</h1>
      <div className="tf-gallery__accents">
        {ACCENTS.map((value) => (
          <Button key={value} size="sm" variant={accent === value ? "primary" : "default"} onClick={() => setVariant(value)}>
            Accent {value}
          </Button>
        ))}
      </div>

      <h2><SectionLabel>Button (sm 24 / md 28 / lg 32)</SectionLabel></h2>
      {VARIANTS.map((variant) => (
        <div key={variant} className="tf-gallery__row" data-testid={`gallery-button-${variant}`}>
          {(["sm", "md", "lg"] as const).map((size) =>
            FORCED.map((state) => (
              <Cell key={`${size}-${state}`} label={`${variant} ${size} ${state}`}>
                <Button size={size} variant={variant} {...forceProps(state)}>
                  Button
                </Button>
              </Cell>
            )),
          )}
        </div>
      ))}

      <h2><SectionLabel>IconButton (24 / 28, danger)</SectionLabel></h2>
      <div className="tf-gallery__row">
        {(["sm", "md"] as const).map((size) =>
          FORCED.map((state) => (
            <Cell key={`${size}-${state}`} label={`${size} ${state}`}>
              <IconButton aria-label="Copy" size={size} {...forceProps(state)}>
                <Copy size={13} />
              </IconButton>
            </Cell>
          )),
        )}
        <Cell label="danger">
          <IconButton aria-label="Close" size="sm" danger>
            <Copy size={13} />
          </IconButton>
        </Cell>
      </div>

      <h2><SectionLabel>Status glyph + pill</SectionLabel></h2>
      <div className="tf-gallery__row" data-testid="gallery-status">
        {STATES.map((state) => (
          <Cell key={state} label={state}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <StatusDot state={state} />
              <StatusPill state={state} />
            </span>
          </Cell>
        ))}
      </div>

      <h2><SectionLabel>Chip, Kbd, SectionLabel</SectionLabel></h2>
      <div className="tf-gallery__row">
        <Chip height={20}>Chip 20</Chip>
        <Chip height={22}>Chip 22</Chip>
        <Chip height={22} active>
          Active
        </Chip>
        <Kbd>Ctrl K</Kbd>
        <SectionLabel>Section label</SectionLabel>
      </div>

      <h2><SectionLabel>ListRow</SectionLabel></h2>
      <div className="tf-gallery__panel">
        {(["rest", "hover", "focus", "selected"] as const).map((state) => (
          <ListRow
            key={state}
            selected={state === "selected"}
            style={{ height: 40, padding: "0 12px", marginBottom: 6 }}
            actions={
              <IconButton aria-label="Copy" size="sm">
                <Copy size={13} />
              </IconButton>
            }
            {...(state === "hover" || state === "focus" ? { "data-force": state } : {})}
          >
            <StatusDot state="running" />
            Row {state}
          </ListRow>
        ))}
      </div>

      <h2><SectionLabel>Field (28 / 30 / 32)</SectionLabel></h2>
      <div className="tf-gallery__row">
        <Field size={28} placeholder="Field 28" aria-label="Field 28" />
        <Field size={30} placeholder="Field 30" aria-label="Field 30" />
        <Field size={32} placeholder="Field 32" aria-label="Field 32" />
        <Field size={28} mono defaultValue="/home/demo/projects" aria-label="Mono field" />
        <Field size={28} disabled placeholder="Disabled" aria-label="Disabled field" />
      </div>

      <h2><SectionLabel>Menu</SectionLabel></h2>
      <Menu style={{ width: 240 }}>
        <MenuItem>Rename</MenuItem>
        <MenuItem data-force="hover">Copy instance reference</MenuItem>
        <MenuItem danger>Close session</MenuItem>
        <MenuItem disabled>Disabled</MenuItem>
      </Menu>

      <h2><SectionLabel>Checkbox</SectionLabel></h2>
      <div className="tf-gallery__row">
        <Checkbox aria-label="Unchecked" />
        <Checkbox aria-label="Checked" defaultChecked />
        <Checkbox aria-label="Disabled" disabled />
      </div>

      <h2><SectionLabel>Dialog</SectionLabel></h2>
      <Button variant="outlined" onClick={() => setDialogOpen(true)}>
        Open dialog
      </Button>
      {dialogOpen && (
        <Dialog
          title="Dialog title"
          width={420}
          onClose={() => setDialogOpen(false)}
          footer={
            <>
              <span style={{ color: "var(--text-2)", fontSize: 11 }}>Esc closes, Tab stays inside.</span>
              <Button variant="primary" size="lg" onClick={() => setDialogOpen(false)}>
                Confirm
              </Button>
            </>
          }
        >
          <div style={{ padding: "0 16px 8px" }}>
            <Field aria-label="Dialog field" placeholder="Focus lands here" />
          </div>
        </Dialog>
      )}
    </div>
  );
}
