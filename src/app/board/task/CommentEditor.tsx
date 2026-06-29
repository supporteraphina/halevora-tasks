"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import styles from "./panel.module.css";

/**
 * Tiptap composer for comments. Reuses the same StarterKit + prose styles as the
 * description editor. `onSubmit` receives the document JSON; the parent clears the editor
 * by remounting it (key change) after a successful post. `initialDoc` seeds an edit.
 */
export function CommentEditor({
  initialDoc,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  initialDoc?: unknown;
  submitLabel: string;
  pending: boolean;
  onSubmit: (json: string) => void;
  onCancel?: () => void;
}) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: isTiptapDoc(initialDoc) ? (initialDoc as object) : "",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: styles.proseInput,
        "aria-label": "Comment",
      },
    },
  });

  function submit() {
    if (!editor || editor.isEmpty) return;
    onSubmit(JSON.stringify(editor.getJSON()));
  }

  if (!editor) {
    return <div className={styles.proseInput} aria-hidden="true" />;
  }

  return (
    <div className={styles.editorWrap}>
      <div className={styles.toolbar} role="toolbar" aria-label="Formatting">
        <ToolbarButton
          label="Bold"
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <strong>B</strong>
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <em>I</em>
        </ToolbarButton>
        <ToolbarButton
          label="Bullet list"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          •
        </ToolbarButton>
        <ToolbarButton
          label="Code block"
          active={editor.isActive("codeBlock")}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          {"</>"}
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} />
      <div className={styles.commentActions}>
        {onCancel ? (
          <button
            type="button"
            className={styles.commentCancel}
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          className={styles.smallBtn}
          onClick={submit}
          disabled={pending || editor.isEmpty}
        >
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </div>
  );
}

function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={styles.toolBtn}
      data-active={active || undefined}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function isTiptapDoc(v: unknown): boolean {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { type?: unknown }).type === "doc"
  );
}
