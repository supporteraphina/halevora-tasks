"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  setCustomFieldValueAction,
  createCustomFieldAction,
  createCommentAction,
  editCommentAction,
  deleteCommentAction,
  uploadAttachmentAction,
  deleteAttachmentAction,
  getAttachmentUrlAction,
  addDependencyAction,
  removeDependencyAction,
  searchLinkableTasksAction,
  setRecurrenceAction,
  clearRecurrenceAction,
  type DetailActionState,
  type LinkSearchResult,
} from "./actions";
import { CommentEditor } from "./CommentEditor";
import { useReportActionError } from "./actionError";
import {
  parseFieldConfig,
  formatFieldValue,
  type CustomFieldKind,
} from "@/domain/customFields";
import { describeActivity } from "@/domain/activity";
import { formatInZone } from "@/domain/dates";
import type {
  TaskDetail,
  PickerData,
  DetailCustomField,
  DetailComment,
  DetailActivity,
  DetailDependency,
} from "./data";
import type { Status } from "@prisma/client";
import styles from "./panel.module.css";

/** Run a server action with a plain-fields FormData, surface any error, then refresh. */
function useAction() {
  const router = useRouter();
  const reportError = useReportActionError();
  const [pending, startTransition] = useTransition();
  const run = (
    action: (s: DetailActionState, fd: FormData) => Promise<DetailActionState>,
    fields: Record<string, string>,
  ) =>
    new Promise<DetailActionState>((resolve) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.set(k, v);
      startTransition(async () => {
        const result = await action({}, fd);
        if (result?.error) reportError(result.error);
        router.refresh();
        resolve(result);
      });
    });
  return { run, pending };
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);
  return { open, setOpen, ref };
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// =====================================================================
//  Custom fields
// =====================================================================

export function CustomFieldsSection({
  task,
  picker,
  isCeo,
}: {
  task: TaskDetail;
  picker: PickerData;
  isCeo: boolean;
}) {
  const [defining, setDefining] = useState(false);

  return (
    <section className={styles.listSection}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>Custom fields</h3>
        {isCeo ? (
          <button
            type="button"
            className={styles.addLink}
            onClick={() => setDefining((v) => !v)}
          >
            {defining ? "Close" : "+ Add field"}
          </button>
        ) : null}
      </div>

      {defining ? (
        <CustomFieldDefiner task={task} onDone={() => setDefining(false)} />
      ) : null}

      {task.customFields.length === 0 && !defining ? (
        <p className={styles.emptyHint}>
          No custom fields on this board yet.
          {isCeo ? " Add one above." : ""}
        </p>
      ) : (
        <div className={styles.cfList}>
          {task.customFields.map((f) => (
            <CustomFieldRow key={f.fieldId} task={task} field={f} picker={picker} />
          ))}
        </div>
      )}
    </section>
  );
}

function CustomFieldDefiner({
  task,
  onDone,
}: {
  task: TaskDetail;
  onDone: () => void;
}) {
  const { run, pending } = useAction();
  const [name, setName] = useState("");
  const [type, setType] = useState<CustomFieldKind>("TEXT");
  const [options, setOptions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const needsOptions = type === "DROPDOWN" || type === "LABELS";

  async function submit() {
    setError(null);
    const result = await run(createCustomFieldAction, {
      taskId: task.id,
      name,
      type,
      options,
    });
    if (result.error) setError(result.error);
    else {
      setName("");
      setOptions("");
      onDone();
    }
  }

  return (
    <div className={styles.cfDefiner}>
      <input
        className={styles.inlineInput}
        placeholder="Field name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="New field name"
      />
      <select
        className={styles.cfSelect}
        value={type}
        onChange={(e) => setType(e.target.value as CustomFieldKind)}
        aria-label="Field type"
      >
        <option value="TEXT">Text</option>
        <option value="NUMBER">Number</option>
        <option value="CHECKBOX">Checkbox</option>
        <option value="DATE">Date</option>
        <option value="DROPDOWN">Dropdown</option>
        <option value="LABELS">Labels (multi-select)</option>
        <option value="RATING">Rating (stars)</option>
        <option value="PEOPLE">People</option>
        <option value="SLIDER">Slider (progress)</option>
      </select>
      {needsOptions ? (
        <textarea
          className={styles.cfOptions}
          placeholder="One option per line"
          value={options}
          onChange={(e) => setOptions(e.target.value)}
          rows={3}
          aria-label="Field options, one per line"
        />
      ) : null}
      {error ? <p className={styles.fieldError}>{error}</p> : null}
      <div className={styles.commentActions}>
        <button
          type="button"
          className={styles.commentCancel}
          onClick={onDone}
          disabled={pending}
        >
          Cancel
        </button>
        <button
          type="button"
          className={styles.smallBtn}
          onClick={submit}
          disabled={pending || name.trim().length === 0}
        >
          {pending ? "Adding…" : "Add field"}
        </button>
      </div>
    </div>
  );
}

function CustomFieldRow({
  task,
  field,
  picker,
}: {
  task: TaskDetail;
  field: DetailCustomField;
  picker: PickerData;
}) {
  return (
    <div className={styles.cfRow}>
      <span className={styles.cfLabel}>{field.name}</span>
      <div className={styles.cfValue}>
        <CustomFieldEditor task={task} field={field} picker={picker} />
      </div>
    </div>
  );
}

function CustomFieldEditor({
  task,
  field,
  picker,
}: {
  task: TaskDetail;
  field: DetailCustomField;
  picker: PickerData;
}) {
  const { run, pending } = useAction();
  const cfg = parseFieldConfig(field.type, field.config);

  function set(value: string) {
    return run(setCustomFieldValueAction, {
      taskId: task.id,
      fieldId: field.fieldId,
      value,
    });
  }

  switch (field.type) {
    case "TEXT":
      return <TextValue field={field} pending={pending} onSet={set} />;
    case "NUMBER":
      return <NumberValue field={field} pending={pending} onSet={set} />;
    case "CHECKBOX":
      return <CheckboxValue field={field} pending={pending} onSet={set} />;
    case "DATE":
      return <DateValue field={field} pending={pending} onSet={set} />;
    case "DROPDOWN":
      return <DropdownValue field={field} cfg={cfg} pending={pending} onSet={set} />;
    case "LABELS":
      return <LabelsValue field={field} cfg={cfg} pending={pending} onSet={set} />;
    case "RATING":
      return <RatingValue field={field} cfg={cfg} pending={pending} onSet={set} />;
    case "PEOPLE":
      return (
        <PeopleValue field={field} picker={picker} pending={pending} onSet={set} />
      );
    case "SLIDER":
      return <SliderValue field={field} cfg={cfg} pending={pending} onSet={set} />;
    default:
      return <span className={styles.placeholder}>—</span>;
  }
}

type EditorProps = {
  field: DetailCustomField;
  pending: boolean;
  onSet: (value: string) => Promise<DetailActionState>;
};

function TextValue({ field, pending, onSet }: EditorProps) {
  const [value, setValue] = useState(
    typeof field.value === "string" ? field.value : "",
  );
  useEffect(() => {
    setValue(typeof field.value === "string" ? field.value : "");
  }, [field.value]);
  return (
    <input
      className={styles.cfInput}
      value={value}
      disabled={pending}
      placeholder="—"
      aria-label={field.name}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value !== (field.value ?? "")) onSet(value);
      }}
    />
  );
}

function NumberValue({ field, pending, onSet }: EditorProps) {
  const [value, setValue] = useState(
    typeof field.value === "number" ? String(field.value) : "",
  );
  useEffect(() => {
    setValue(typeof field.value === "number" ? String(field.value) : "");
  }, [field.value]);
  return (
    <input
      className={styles.cfInput}
      type="number"
      value={value}
      disabled={pending}
      placeholder="—"
      aria-label={field.name}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onSet(value)}
    />
  );
}

function CheckboxValue({ field, pending, onSet }: EditorProps) {
  const checked = field.value === true;
  return (
    <label className={styles.cfCheckbox}>
      <input
        type="checkbox"
        checked={checked}
        disabled={pending}
        aria-label={field.name}
        onChange={(e) => onSet(e.target.checked ? "true" : "false")}
      />
      <span>{checked ? "Yes" : "No"}</span>
    </label>
  );
}

function DateValue({ field, pending, onSet }: EditorProps) {
  const current = typeof field.value === "string" ? field.value : "";
  return (
    <input
      className={styles.cfInput}
      type="date"
      defaultValue={current}
      disabled={pending}
      aria-label={field.name}
      onChange={(e) => onSet(e.target.value)}
    />
  );
}

function DropdownValue({
  field,
  cfg,
  pending,
  onSet,
}: EditorProps & { cfg: ReturnType<typeof parseFieldConfig> }) {
  const current = typeof field.value === "string" ? field.value : "";
  return (
    <select
      className={styles.cfSelect}
      value={current}
      disabled={pending}
      aria-label={field.name}
      onChange={(e) => onSet(e.target.value)}
    >
      <option value="">—</option>
      {cfg.options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function LabelsValue({
  field,
  cfg,
  pending,
  onSet,
}: EditorProps & { cfg: ReturnType<typeof parseFieldConfig> }) {
  const { open, setOpen, ref } = usePopover();
  const selected = new Set(Array.isArray(field.value) ? (field.value as string[]) : []);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSet(JSON.stringify([...next]));
  }

  return (
    <div className={styles.cfValueInner} ref={ref}>
      <button
        type="button"
        className={styles.chipBtn}
        disabled={pending}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {selected.size === 0 ? (
          <span className={styles.placeholder}>+ Select</span>
        ) : (
          <span className={styles.tagList}>
            {cfg.options
              .filter((o) => selected.has(o.id))
              .map((o) => (
                <span key={o.id} className={styles.tag}>
                  {o.label}
                </span>
              ))}
          </span>
        )}
      </button>
      {open ? (
        <div className={styles.menu} role="menu">
          {cfg.options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={selected.has(o.id)}
              className={styles.menuOption}
              onClick={() => toggle(o.id)}
            >
              <span className={styles.menuOptionText}>{o.label}</span>
              {selected.has(o.id) ? <Check /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RatingValue({
  field,
  cfg,
  pending,
  onSet,
}: EditorProps & { cfg: ReturnType<typeof parseFieldConfig> }) {
  const current = typeof field.value === "number" ? field.value : 0;
  return (
    <div className={styles.stars} role="radiogroup" aria-label={field.name}>
      {Array.from({ length: cfg.max }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          className={styles.star}
          data-on={n <= current || undefined}
          disabled={pending}
          role="radio"
          aria-checked={n === current}
          aria-label={`${n} of ${cfg.max}`}
          // Click the current star again to clear (set 0).
          onClick={() => onSet(String(n === current ? 0 : n))}
        >
          <StarIcon filled={n <= current} />
        </button>
      ))}
      <span className={styles.starCount}>{current > 0 ? `${current}/${cfg.max}` : ""}</span>
    </div>
  );
}

function PeopleValue({
  field,
  picker,
  pending,
  onSet,
}: EditorProps & { picker: PickerData }) {
  const { open, setOpen, ref } = usePopover();
  const selected = new Set(Array.isArray(field.value) ? (field.value as string[]) : []);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSet(JSON.stringify([...next]));
  }

  const chosen = picker.users.filter((u) => selected.has(u.id));

  return (
    <div className={styles.cfValueInner} ref={ref}>
      <button
        type="button"
        className={styles.chipBtn}
        disabled={pending}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {chosen.length === 0 ? (
          <span className={styles.placeholder}>+ Add people</span>
        ) : (
          <span className={styles.avatars}>
            {chosen.map((u) => (
              <span key={u.id} className={styles.avatar} title={u.name}>
                {initials(u.name)}
              </span>
            ))}
          </span>
        )}
      </button>
      {open ? (
        <div className={styles.menu} role="menu">
          {picker.users.map((u) => (
            <button
              key={u.id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={selected.has(u.id)}
              className={styles.menuOption}
              onClick={() => toggle(u.id)}
            >
              <span className={styles.avatar}>{initials(u.name)}</span>
              <span className={styles.menuOptionText}>{u.name}</span>
              {selected.has(u.id) ? <Check /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SliderValue({
  field,
  cfg,
  pending,
  onSet,
}: EditorProps & { cfg: ReturnType<typeof parseFieldConfig> }) {
  const current = typeof field.value === "number" ? field.value : cfg.min;
  const [value, setValue] = useState(current);
  useEffect(() => {
    setValue(typeof field.value === "number" ? field.value : cfg.min);
  }, [field.value, cfg.min]);

  const pct = ((value - cfg.min) / (cfg.max - cfg.min)) * 100;

  return (
    <div className={styles.sliderWrap}>
      <input
        type="range"
        className={styles.slider}
        min={cfg.min}
        max={cfg.max}
        value={value}
        disabled={pending}
        aria-label={field.name}
        style={{ ["--pct" as string]: `${pct}%` }}
        onChange={(e) => setValue(Number(e.target.value))}
        onMouseUp={() => onSet(String(value))}
        onTouchEnd={() => onSet(String(value))}
        onKeyUp={() => onSet(String(value))}
      />
      <span className={styles.sliderValue}>{value}%</span>
    </div>
  );
}

// =====================================================================
//  Attachments
// =====================================================================

export function AttachmentsSection({ task }: { task: TaskDetail }) {
  const { run, pending } = useAction();
  const router = useRouter();
  const [uploading, startUpload] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const fd = new FormData();
    fd.set("taskId", task.id);
    fd.set("file", file);
    startUpload(async () => {
      const result = await uploadAttachmentAction({}, fd);
      if (result.error) setError(result.error);
      router.refresh();
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  async function download(attachmentId: string) {
    const result = await getAttachmentUrlAction(task.id, attachmentId);
    if (result.url) window.open(result.url, "_blank", "noopener,noreferrer");
    else setError(result.error ?? "Could not open the file.");
  }

  return (
    <section className={styles.listSection}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>
          Attachments
          {task.attachments.length > 0 ? (
            <span className={styles.countPill}>{task.attachments.length}</span>
          ) : null}
        </h3>
        {task.attachmentsEnabled ? (
          <>
            <input
              ref={fileRef}
              type="file"
              className={styles.hiddenFile}
              onChange={onPick}
              aria-label="Upload attachment"
            />
            <button
              type="button"
              className={styles.addLink}
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? "Uploading…" : "+ Add file"}
            </button>
          </>
        ) : null}
      </div>

      {!task.attachmentsEnabled ? (
        <div className={styles.disabledBox} role="status">
          <LockIcon />
          <span>Attachments need SUPABASE_SERVICE_ROLE_KEY in .env</span>
        </div>
      ) : null}

      {error ? <p className={styles.fieldError}>{error}</p> : null}

      {task.attachmentsEnabled && task.attachments.length === 0 ? (
        <p className={styles.emptyHint}>No files yet.</p>
      ) : null}

      <ul className={styles.attachList}>
        {task.attachments.map((a) => (
          <li key={a.id} className={styles.attachItem}>
            <FileIcon />
            <button
              type="button"
              className={styles.attachName}
              onClick={() => download(a.id)}
              title="Download"
            >
              {a.filename}
            </button>
            <span className={styles.attachSize}>{formatBytes(a.size)}</span>
            <button
              type="button"
              className={styles.iconBtn}
              disabled={pending}
              aria-label="Delete attachment"
              onClick={() =>
                run(deleteAttachmentAction, { taskId: task.id, attachmentId: a.id })
              }
            >
              <Trash />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// =====================================================================
//  Dependencies (blocking / waiting-on links)
// =====================================================================

const DEP_TONE: Record<Status, string> = {
  TODO: "todo",
  IN_PROGRESS: "progress",
  DONE: "done",
  REVIEWED: "reviewed",
};
const DEP_STATUS_TEXT: Record<Status, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  DONE: "Done",
  REVIEWED: "Reviewed",
};

export function DependenciesSection({ task }: { task: TaskDetail }) {
  return (
    <section className={styles.listSection}>
      <h3 className={styles.sectionTitle}>Dependencies</h3>

      {task.openBlockerCount > 0 ? (
        <p className={styles.depGateHint} role="status">
          This task is blocked by {task.openBlockerCount} open task
          {task.openBlockerCount === 1 ? "" : "s"}. It cannot be marked Done until they close.
        </p>
      ) : null}

      <DependencyList
        task={task}
        direction="waiting_on"
        label="Waiting on"
        hint="Tasks that must close before this one can be Done."
        items={task.waitingOn}
        addLabel="+ Add blocker"
      />
      <DependencyList
        task={task}
        direction="blocking"
        label="Blocking"
        hint="Tasks that cannot be Done until this one closes."
        items={task.blocking}
        addLabel="+ Add blocked task"
      />
    </section>
  );
}

function DependencyList({
  task,
  direction,
  label,
  hint,
  items,
  addLabel,
}: {
  task: TaskDetail;
  direction: "waiting_on" | "blocking";
  label: string;
  hint: string;
  items: DetailDependency[];
  addLabel: string;
}) {
  const { run, pending } = useAction();
  const [adding, setAdding] = useState(false);

  return (
    <div className={styles.depBlock}>
      <div className={styles.sectionHeader}>
        <span className={styles.depHeading}>
          {label}
          {items.length > 0 ? (
            <span className={styles.countPill}>{items.length}</span>
          ) : null}
        </span>
        <button
          type="button"
          className={styles.addLink}
          onClick={() => setAdding((v) => !v)}
        >
          {adding ? "Close" : addLabel}
        </button>
      </div>

      {adding ? (
        <DependencyPicker
          task={task}
          direction={direction}
          onDone={() => setAdding(false)}
        />
      ) : null}

      {items.length === 0 && !adding ? (
        <p className={styles.emptyHint}>{hint}</p>
      ) : (
        <ul className={styles.depList}>
          {items.map((d) => (
            <li key={d.taskId} className={styles.depItem}>
              <span
                className={styles.depDot}
                data-tone={DEP_TONE[d.status]}
                aria-hidden="true"
              />
              <a className={styles.depTitle} href={`/board/task/${d.taskId}`}>
                {d.title}
              </a>
              <span className={styles.depStatus}>{DEP_STATUS_TEXT[d.status]}</span>
              <button
                type="button"
                className={styles.iconBtn}
                disabled={pending}
                aria-label={`Remove link to ${d.title}`}
                onClick={() =>
                  run(removeDependencyAction, {
                    taskId: task.id,
                    otherId: d.taskId,
                    direction,
                  })
                }
              >
                <Trash />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DependencyPicker({
  task,
  direction,
  onDone,
}: {
  task: TaskDetail;
  direction: "waiting_on" | "blocking";
  onDone: () => void;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LinkSearchResult[]>([]);
  const [searching, startSearch] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Debounced SCOPED search — only returns tasks the actor may see.
  useEffect(() => {
    const handle = setTimeout(() => {
      startSearch(async () => {
        const res = await searchLinkableTasksAction(task.id, query);
        if (res.error) setError(res.error);
        else setResults(res.results ?? []);
      });
    }, 200);
    return () => clearTimeout(handle);
  }, [query, task.id]);

  async function pick(otherId: string) {
    setError(null);
    const result = await run(addDependencyAction, {
      taskId: task.id,
      otherId,
      direction,
    });
    if (result.error) setError(result.error);
    else {
      onDone();
      router.refresh();
    }
  }

  return (
    <div className={styles.depPicker}>
      <input
        className={styles.inlineInput}
        placeholder="Search tasks to link…"
        value={query}
        autoFocus
        disabled={pending}
        aria-label="Search tasks to link"
        onChange={(e) => setQuery(e.target.value)}
      />
      {error ? <p className={styles.fieldError}>{error}</p> : null}
      <div className={styles.depResults}>
        {searching ? (
          <p className={styles.emptyHint}>Searching…</p>
        ) : results.length === 0 ? (
          <p className={styles.emptyHint}>No matching tasks you can link.</p>
        ) : (
          results.map((r) => (
            <button
              key={r.id}
              type="button"
              className={styles.depResult}
              disabled={pending}
              onClick={() => pick(r.id)}
            >
              <span
                className={styles.depDot}
                data-tone={DEP_TONE[r.status]}
                aria-hidden="true"
              />
              <span className={styles.depResultText}>{r.title}</span>
              <span className={styles.depResultBoard}>{r.boardName}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// =====================================================================
//  Recurrence (recurring-task config — matches the ClickUp picker)
// =====================================================================

const CADENCE_OPTIONS: { value: string; label: string }[] = [
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "YEARLY", label: "Yearly" },
  { value: "CUSTOM", label: "Custom (every N days)" },
];

const REC_STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: "TODO", label: "To Do" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "DONE", label: "Done" },
  { value: "REVIEWED", label: "Reviewed" },
];

const STATUS_LABEL: Record<Status, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  DONE: "Done",
  REVIEWED: "Reviewed",
};

const CADENCE_LABEL: Record<string, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  YEARLY: "Yearly",
  CUSTOM: "Custom",
};

export function RecurrenceSection({
  task,
  timezone,
}: {
  task: TaskDetail;
  timezone: string;
}) {
  const { run, pending } = useAction();
  const rec = task.recurrence;
  const [editing, setEditing] = useState(false);

  // Form state, seeded from the existing rule or sensible defaults.
  const [cadence, setCadence] = useState<string>(rec?.cadence ?? "WEEKLY");
  const [interval, setInterval] = useState<string>(
    rec ? String(rec.interval) : "1",
  );
  const [trigger, setTrigger] = useState<string>(
    rec?.trigger ?? "ON_STATUS_CHANGE",
  );
  const [triggerStatus, setTriggerStatus] = useState<Status>(
    rec?.triggerStatus ?? "REVIEWED",
  );
  const [statusOnRecur, setStatusOnRecur] = useState<Status>(
    rec?.statusOnRecur ?? "TODO",
  );
  const [syncToDueDate, setSyncToDueDate] = useState<boolean>(
    rec?.syncToDueDate ?? true,
  );
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setCadence(rec?.cadence ?? "WEEKLY");
    setInterval(rec ? String(rec.interval) : "1");
    setTrigger(rec?.trigger ?? "ON_STATUS_CHANGE");
    setTriggerStatus(rec?.triggerStatus ?? "REVIEWED");
    setStatusOnRecur(rec?.statusOnRecur ?? "TODO");
    setSyncToDueDate(rec?.syncToDueDate ?? true);
    setError(null);
  }

  async function save() {
    setError(null);
    const result = await run(setRecurrenceAction, {
      taskId: task.id,
      cadence,
      interval,
      trigger,
      triggerStatus,
      statusOnRecur,
      syncToDueDate: syncToDueDate ? "true" : "false",
    });
    if (result.error) setError(result.error);
    else setEditing(false);
  }

  async function remove() {
    setError(null);
    await run(clearRecurrenceAction, { taskId: task.id });
    setEditing(false);
  }

  // Collapsed summary when a rule exists and we are not editing.
  if (rec && !editing) {
    return (
      <section className={styles.listSection}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>Recurring</h3>
          <button
            type="button"
            className={styles.addLink}
            onClick={() => {
              reset();
              setEditing(true);
            }}
          >
            Edit
          </button>
        </div>
        <div className={styles.recSummary}>
          <RepeatIcon />
          <div className={styles.recSummaryText}>
            <span className={styles.recSummaryLine}>
              {CADENCE_LABEL[rec.cadence]}
              {rec.interval > 1 ? ` (every ${rec.interval})` : ""}
              {" · "}
              {rec.trigger === "ON_STATUS_CHANGE"
                ? `on status change to ${STATUS_LABEL[rec.triggerStatus]}`
                : "on schedule"}
            </span>
            <span className={styles.recSummarySub}>
              New task resets to {STATUS_LABEL[rec.statusOnRecur]}
              {rec.syncToDueDate ? " · dates advance" : ""}
              {rec.trigger === "ON_SCHEDULE" && rec.nextRunAt
                ? ` · next ${formatInZone(new Date(rec.nextRunAt), timezone)}`
                : ""}
            </span>
          </div>
        </div>
      </section>
    );
  }

  // Editor (also the empty-state "Add recurrence"): matches the screenshot's picker.
  return (
    <section className={styles.listSection}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>Recurring</h3>
        {!editing ? (
          <button
            type="button"
            className={styles.addLink}
            onClick={() => {
              reset();
              setEditing(true);
            }}
          >
            + Set recurrence
          </button>
        ) : null}
      </div>

      {!editing ? (
        <p className={styles.emptyHint}>This task does not repeat.</p>
      ) : (
        <div className={styles.recCard}>
          <label className={styles.recField}>
            <span className={styles.recLabel}>Repeats</span>
            <select
              className={styles.cfSelect}
              value={cadence}
              disabled={pending}
              aria-label="Cadence"
              onChange={(e) => setCadence(e.target.value)}
            >
              {CADENCE_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.recField}>
            <span className={styles.recLabel}>Every</span>
            <span className={styles.recInterval}>
              <input
                type="number"
                min={1}
                max={365}
                className={styles.recIntervalInput}
                value={interval}
                disabled={pending}
                aria-label="Interval"
                onChange={(e) => setInterval(e.target.value)}
              />
              <span className={styles.recUnit}>{cadenceUnit(cadence, interval)}</span>
            </span>
          </label>

          <label className={styles.recField}>
            <span className={styles.recLabel}>Trigger</span>
            <select
              className={styles.cfSelect}
              value={trigger}
              disabled={pending}
              aria-label="Recurrence trigger"
              onChange={(e) => setTrigger(e.target.value)}
            >
              <option value="ON_STATUS_CHANGE">On status change</option>
              <option value="ON_SCHEDULE">On schedule</option>
            </select>
          </label>

          {trigger === "ON_STATUS_CHANGE" ? (
            <label className={styles.recField}>
              <span className={styles.recLabel}>When status becomes</span>
              <select
                className={styles.cfSelect}
                value={triggerStatus}
                disabled={pending}
                aria-label="Trigger status"
                onChange={(e) => setTriggerStatus(e.target.value as Status)}
              >
                {REC_STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <p className={styles.recNote}>
            <CheckSquare /> Create a new task (the completed one leaves the board)
          </p>

          <label className={styles.recField}>
            <span className={styles.recLabel}>Update status to</span>
            <select
              className={styles.cfSelect}
              value={statusOnRecur}
              disabled={pending}
              aria-label="Status on recur"
              onChange={(e) => setStatusOnRecur(e.target.value as Status)}
            >
              {REC_STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.recCheckRow}>
            <input
              type="checkbox"
              checked={syncToDueDate}
              disabled={pending}
              onChange={(e) => setSyncToDueDate(e.target.checked)}
            />
            <span>Sync recurrence to due date</span>
          </label>

          {error ? <p className={styles.fieldError}>{error}</p> : null}

          <div className={styles.recActions}>
            {rec ? (
              <button
                type="button"
                className={styles.recRemove}
                disabled={pending}
                onClick={remove}
              >
                Remove
              </button>
            ) : null}
            <span className={styles.recActionsRight}>
              <button
                type="button"
                className={styles.commentCancel}
                disabled={pending}
                onClick={() => {
                  reset();
                  setEditing(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.smallBtn}
                disabled={pending}
                onClick={save}
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

function cadenceUnit(cadence: string, interval: string): string {
  const n = Number(interval) || 1;
  const plural = n === 1 ? "" : "s";
  switch (cadence) {
    case "WEEKLY":
      return `week${plural}`;
    case "MONTHLY":
      return `month${plural}`;
    case "YEARLY":
      return `year${plural}`;
    default:
      return `day${plural}`;
  }
}

// =====================================================================
//  Comments + activity feed (combined, newest-first)
// =====================================================================

type FeedEntry =
  | { kind: "comment"; at: Date; comment: DetailComment }
  | { kind: "activity"; at: Date; activity: DetailActivity };

export function ActivitySection({
  task,
  timezone,
  currentUserId,
}: {
  task: TaskDetail;
  timezone: string;
  currentUserId: string;
}) {
  const { run, pending } = useAction();
  const router = useRouter();
  const [posting, startPost] = useTransition();
  const [composerKey, setComposerKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Merge comments + activity into one newest-first feed.
  const entries: FeedEntry[] = [
    ...task.comments.map(
      (c): FeedEntry => ({ kind: "comment", at: new Date(c.createdAt), comment: c }),
    ),
    ...task.activity.map(
      (a): FeedEntry => ({ kind: "activity", at: new Date(a.createdAt), activity: a }),
    ),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  function post(json: string) {
    setError(null);
    const fd = new FormData();
    fd.set("taskId", task.id);
    fd.set("body", json);
    startPost(async () => {
      const result = await createCommentAction({}, fd);
      if (result.error) setError(result.error);
      else setComposerKey((k) => k + 1); // remount the editor to clear it
      router.refresh();
    });
  }

  return (
    <section className={styles.feedSection}>
      <h3 className={styles.sectionTitle}>Comments &amp; activity</h3>

      <CommentEditor
        key={composerKey}
        submitLabel="Comment"
        pending={posting}
        onSubmit={post}
      />
      {error ? <p className={styles.fieldError}>{error}</p> : null}

      <ol className={styles.feed}>
        {entries.length === 0 ? (
          <li className={styles.emptyHint}>No activity yet. Be the first to comment.</li>
        ) : null}
        {entries.map((entry) =>
          entry.kind === "comment" ? (
            <CommentItem
              key={`c-${entry.comment.id}`}
              task={task}
              comment={entry.comment}
              timezone={timezone}
              currentUserId={currentUserId}
              run={run}
              pending={pending}
            />
          ) : (
            <ActivityItem
              key={`a-${entry.activity.id}`}
              activity={entry.activity}
              timezone={timezone}
            />
          ),
        )}
      </ol>
    </section>
  );
}

function CommentItem({
  task,
  comment,
  timezone,
  currentUserId,
  run,
  pending,
}: {
  task: TaskDetail;
  comment: DetailComment;
  timezone: string;
  currentUserId: string;
  run: (
    action: (s: DetailActionState, fd: FormData) => Promise<DetailActionState>,
    fields: Record<string, string>,
  ) => Promise<DetailActionState>;
  pending: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, startSave] = useTransition();
  const mine = comment.authorId === currentUserId;

  function saveEdit(json: string) {
    const fd = new FormData();
    fd.set("taskId", task.id);
    fd.set("commentId", comment.id);
    fd.set("body", json);
    startSave(async () => {
      await editCommentAction({}, fd);
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <li className={styles.feedItem}>
      <span className={styles.avatar} aria-hidden="true">
        {initials(comment.authorName ?? "?")}
      </span>
      <div className={styles.feedBody}>
        <div className={styles.feedMeta}>
          <span className={styles.feedAuthor}>{comment.authorName ?? "Someone"}</span>
          <span className={styles.feedTime}>
            {formatInZone(new Date(comment.createdAt), timezone)}
          </span>
          {mine ? (
            <span className={styles.feedTools}>
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => setEditing((v) => !v)}
              >
                {editing ? "Cancel" : "Edit"}
              </button>
              <button
                type="button"
                className={styles.linkBtn}
                disabled={pending}
                onClick={() => {
                  if (window.confirm("Delete this comment?")) {
                    run(deleteCommentAction, { taskId: task.id, commentId: comment.id });
                  }
                }}
              >
                Delete
              </button>
            </span>
          ) : null}
        </div>
        {editing ? (
          <CommentEditor
            initialDoc={comment.body}
            submitLabel="Save"
            pending={saving}
            onSubmit={saveEdit}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <ReadOnlyComment doc={comment.body} />
        )}
      </div>
    </li>
  );
}

function ActivityItem({
  activity,
  timezone,
}: {
  activity: DetailActivity;
  timezone: string;
}) {
  return (
    <li className={styles.activityItem}>
      <span className={styles.activityDot} aria-hidden="true" />
      <span className={styles.activityText}>
        <strong>{activity.actorName ?? "Someone"}</strong>{" "}
        {describeActivity(activity.type, activity.data)}
      </span>
      <span className={styles.feedTime}>
        {formatInZone(new Date(activity.createdAt), timezone)}
      </span>
    </li>
  );
}

/** Read-only Tiptap render of a stored comment document. */
function ReadOnlyComment({ doc }: { doc: unknown }) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: isTiptapDoc(doc) ? (doc as object) : "",
    editable: false,
    immediatelyRender: false,
    editorProps: { attributes: { class: styles.commentRendered } },
  });
  if (!editor) return null;
  return <EditorContent editor={editor} />;
}

function isTiptapDoc(v: unknown): boolean {
  return (
    typeof v === "object" && v !== null && (v as { type?: unknown }).type === "doc"
  );
}

// =====================================================================
//  Icons
// =====================================================================

function Check() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M2.5 6.5l2.5 2.5 4.5-5.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Trash() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M2.5 3.5h9M5 3.5V2.5h4v1M3.5 3.5l.5 8h6l.5-8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill={filled ? "currentColor" : "none"}>
      <path
        d="M8 1.5l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.3 4.2 13.3l.7-4.3-3.1-3 4.3-.6z"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 1.5h5l3 3v10H4z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M9 1.5v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function RepeatIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 6a4 4 0 016.9-2.2L12 6M13 10a4 4 0 01-6.9 2.2L4 10"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 3v3H9M4 13v-3h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckSquare() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4.2 7l2 2 3.6-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
