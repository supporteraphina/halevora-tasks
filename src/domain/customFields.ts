/**
 * Custom fields — pure, framework-free value parse / validate / format logic.
 *
 * A `CustomField` is defined per Board; its `config` JSON holds type specifics
 * (dropdown/labels options, rating max, slider min/max). A `CustomFieldValue.value`
 * JSON holds the per-task value. The server action persists `value`; this module is the
 * single source of truth for what a valid value is and how to render it, so the action
 * stays thin and the rules are exhaustively unit-tested (a bad value must never persist).
 *
 * The nine v1 field kinds (per handoff 00 §5 / handoff 05): TEXT, NUMBER, CHECKBOX, DATE,
 * DROPDOWN, LABELS, RATING, PEOPLE, SLIDER. Mirror of the Prisma `CustomFieldType` enum.
 */

export const CUSTOM_FIELD_TYPES = [
  "TEXT",
  "NUMBER",
  "CHECKBOX",
  "DATE",
  "DROPDOWN",
  "LABELS",
  "RATING",
  "PEOPLE",
  "SLIDER",
] as const;

export type CustomFieldKind = (typeof CUSTOM_FIELD_TYPES)[number];

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** A dropdown / labels option. `id` is stable; `label` is what we render. */
export interface FieldOption {
  id: string;
  label: string;
  color?: string | null;
}

/**
 * Normalized field config — every kind gets the same shape, with defaults filled.
 * `max` means "star count" for RATING and "slider upper bound" for SLIDER (a field is
 * only ever one kind, so a single field is unambiguous). `min` is the SLIDER lower bound.
 */
export interface FieldConfig {
  options: FieldOption[]; // DROPDOWN / LABELS
  min: number; // SLIDER lower bound
  max: number; // RATING star count, or SLIDER upper bound
}

const MAX_TEXT = 5000;
const MAX_RATING = 10;
const DEFAULT_RATING_MAX = 5;

/** True for a string that is one of the nine field kinds. */
export function isCustomFieldKind(v: string): v is CustomFieldKind {
  return (CUSTOM_FIELD_TYPES as readonly string[]).includes(v);
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

/**
 * Normalize a stored `config` JSON for the given kind into a complete `FieldConfig`,
 * filling sane defaults. Always returns a usable config — never throws on bad input.
 */
export function parseFieldConfig(kind: CustomFieldKind, raw: unknown): FieldConfig {
  const r = asRecord(raw);

  // options (DROPDOWN / LABELS)
  const options: FieldOption[] = Array.isArray(r.options)
    ? (r.options as unknown[]).flatMap((o) => {
        const rec = asRecord(o);
        const id = typeof rec.id === "string" ? rec.id : null;
        const label =
          typeof rec.label === "string" ? rec.label : id ? id : null;
        if (!id || !label) return [];
        const opt: FieldOption = { id, label };
        if (typeof rec.color === "string") opt.color = rec.color;
        return [opt];
      })
    : [];

  if (kind === "SLIDER") {
    // SLIDER: min/max bounds, default 0..100; fall back to 0..100 if inverted.
    let min = typeof r.min === "number" ? r.min : 0;
    let max = typeof r.max === "number" ? r.max : 100;
    if (!(min < max)) {
      min = 0;
      max = 100;
    }
    return { options, min, max };
  }

  // RATING (and any other kind): `max` is the star count, clamped to 1..10, default 5.
  let max =
    typeof r.max === "number" && Number.isInteger(r.max) ? r.max : DEFAULT_RATING_MAX;
  if (max < 1) max = DEFAULT_RATING_MAX;
  if (max > MAX_RATING) max = MAX_RATING;

  return { options, min: 0, max };
}

/**
 * Parse + validate a raw form string into the JSON value to persist for a field.
 * Returns `{ ok: true, value }` where `value` is the storable JSON (or null to clear),
 * or `{ ok: false, error }`. NEVER throws — the action surfaces the error string.
 *
 * Multi-value kinds (LABELS, PEOPLE) receive a JSON-encoded array string.
 */
export function parseFieldValue(
  kind: CustomFieldKind,
  rawConfig: unknown,
  raw: string,
): Parsed<unknown> {
  const cfg = parseFieldConfig(kind, rawConfig);
  const s = (raw ?? "").toString();

  switch (kind) {
    case "TEXT": {
      const t = s.trim();
      if (t.length === 0) return { ok: true, value: null };
      if (t.length > MAX_TEXT) return { ok: false, error: "That text is too long." };
      return { ok: true, value: t };
    }

    case "NUMBER": {
      const t = s.trim();
      if (t.length === 0) return { ok: true, value: null };
      const n = Number(t);
      if (!Number.isFinite(n)) return { ok: false, error: "Enter a valid number." };
      return { ok: true, value: n };
    }

    case "CHECKBOX": {
      const t = s.trim().toLowerCase();
      return { ok: true, value: t === "true" || t === "1" || t === "on" || t === "yes" };
    }

    case "DATE": {
      const t = s.trim();
      if (t.length === 0) return { ok: true, value: null };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
        return { ok: false, error: "Enter a valid date." };
      }
      const d = new Date(`${t}T00:00:00Z`);
      // Round-trip guard catches overflow like 2026-13-99.
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t) {
        return { ok: false, error: "Enter a valid date." };
      }
      return { ok: true, value: t };
    }

    case "DROPDOWN": {
      const t = s.trim();
      if (t.length === 0) return { ok: true, value: null };
      if (!cfg.options.some((o) => o.id === t)) {
        return { ok: false, error: "Pick one of the configured options." };
      }
      return { ok: true, value: t };
    }

    case "LABELS": {
      const ids = parseJsonStringArray(s);
      if (ids === null) return { ok: false, error: "Could not read the selection." };
      const known = new Set(cfg.options.map((o) => o.id));
      const clean: string[] = [];
      for (const id of ids) {
        if (!known.has(id)) {
          return { ok: false, error: "Pick from the configured options." };
        }
        if (!clean.includes(id)) clean.push(id);
      }
      return { ok: true, value: clean.length === 0 ? null : clean };
    }

    case "RATING": {
      const t = s.trim();
      if (t.length === 0) return { ok: true, value: null };
      const n = Number(t);
      if (!Number.isInteger(n) || n < 0) {
        return { ok: false, error: "Pick a whole-star rating." };
      }
      if (n > cfg.max) return { ok: false, error: "Rating is above the maximum." };
      return { ok: true, value: n === 0 ? null : n };
    }

    case "PEOPLE": {
      const ids = parseJsonStringArray(s);
      if (ids === null) return { ok: false, error: "Could not read the selection." };
      const clean: string[] = [];
      for (const id of ids) {
        if (!clean.includes(id)) clean.push(id);
      }
      return { ok: true, value: clean.length === 0 ? null : clean };
    }

    case "SLIDER": {
      const t = s.trim();
      if (t.length === 0) return { ok: true, value: null };
      const n = Number(t);
      if (!Number.isFinite(n)) return { ok: false, error: "Enter a valid value." };
      if (n < cfg.min || n > cfg.max) {
        return { ok: false, error: "Value is out of range." };
      }
      return { ok: true, value: n };
    }
  }
}

/** Render a stored value for read-only display. Unset => em-dash. */
export function formatFieldValue(
  kind: CustomFieldKind,
  cfg: FieldConfig | null,
  value: unknown,
): string {
  if (value === null || value === undefined) return "—";
  const c = cfg ?? parseFieldConfig(kind, null);

  switch (kind) {
    case "TEXT":
      return typeof value === "string" ? value : "—";
    case "NUMBER":
      return typeof value === "number" ? String(value) : "—";
    case "CHECKBOX":
      return value ? "Yes" : "No";
    case "DATE":
      return typeof value === "string" ? value : "—";
    case "DROPDOWN": {
      const opt = c.options.find((o) => o.id === value);
      return opt ? opt.label : "—";
    }
    case "LABELS": {
      if (!Array.isArray(value) || value.length === 0) return "—";
      const labels = value
        .map((id) => c.options.find((o) => o.id === id)?.label)
        .filter((l): l is string => !!l);
      return labels.length ? labels.join(", ") : "—";
    }
    case "RATING":
      return typeof value === "number" ? `${value}/${c.max}` : "—";
    case "PEOPLE":
      return Array.isArray(value) && value.length ? `${value.length} assigned` : "—";
    case "SLIDER":
      return typeof value === "number" ? `${value}%` : "—";
  }
}

/** Parse a JSON-encoded array of strings. Returns null on any malformed input. */
function parseJsonStringArray(raw: string): string[] | null {
  const t = raw.trim();
  if (t.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(t);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  if (!parsed.every((x) => typeof x === "string")) return null;
  return parsed as string[];
}
