"use client";

import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import styles from "./panel.module.css";

/**
 * Tiptap rich-text description editor. Persists the document JSON to Task.description
 * via `onSave` (called on blur, when the doc changed). `insertText` lets the AI-assist
 * button drop a draft paragraph into the editor; `onInserted` clears that prop after.
 */
export function DescriptionEditor({
  initialDoc,
  insertText,
  onInserted,
  onSave,
  saving,
}: {
  initialDoc: unknown;
  insertText: string | null;
  onInserted: () => void;
  onSave: (json: string) => void;
  saving: boolean;
}) {
  const editor = useEditor({
    extensions: [StarterKit],
    // A null/empty description starts the editor empty; otherwise hydrate the stored doc.
    content: isTiptapDoc(initialDoc) ? (initialDoc as object) : "",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: styles.proseInput,
        "aria-label": "Task description",
      },
    },
    onBlur: ({ editor }) => {
      const json = editor.isEmpty ? "" : JSON.stringify(editor.getJSON());
      onSave(json);
    },
  });

  // When the AI button produces text, append it as a paragraph and persist immediately.
  useEffect(() => {
    if (!editor || !insertText) return;
    editor
      .chain()
      .focus("end")
      .insertContent(
        insertText
          .split(/\n{2,}/)
          .map((p) => ({
            type: "paragraph",
            content: p.trim() ? [{ type: "text", text: p.trim() }] : [],
          })),
      )
      .run();
    onSave(JSON.stringify(editor.getJSON()));
    onInserted();
  }, [editor, insertText, onInserted, onSave]);

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
          label="Heading"
          active={editor.isActive("heading", { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          H
        </ToolbarButton>
        <ToolbarButton
          label="Bullet list"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          •
        </ToolbarButton>
        <ToolbarButton
          label="Ordered list"
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          1.
        </ToolbarButton>
        <ToolbarButton
          label="Code block"
          active={editor.isActive("codeBlock")}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          {"</>"}
        </ToolbarButton>
        {saving ? <span className={styles.savingHint}>Saving…</span> : null}
      </div>
      <EditorContent editor={editor} />
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
      // Keep focus in the editor so onBlur-save doesn't fire on a formatting click.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Cheap guard: a Tiptap doc is `{ type: "doc", content: [...] }`. */
function isTiptapDoc(v: unknown): boolean {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { type?: unknown }).type === "doc"
  );
}
