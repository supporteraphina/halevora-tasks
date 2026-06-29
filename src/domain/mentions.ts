/**
 * @mention parsing. Pure, framework-free domain logic.
 *
 * Section 12 lets a user @mention teammates in (a) a chat message (plain text) and (b) a
 * task comment (a Tiptap document). Both surfaces use the SAME token grammar so the rule is
 * one place: an `@` followed by a handle, where a handle is the user's name with spaces
 * collapsed to nothing OR their email local-part — matched case-insensitively against the
 * known users. We resolve to real user ids here; the server then writes notifications.
 *
 * THE security note: extraction is PURELY syntactic — it never widens visibility. Resolving a
 * mention to a user id does NOT grant that user access to the task/board. The server decides
 * (and documents) whether a mention notification is emitted; the linked task still 404s under
 * scope if the recipient can't otherwise see it (see src/lib/notifications.ts). Keep this pure.
 */

/** A candidate user a mention can resolve to. Names/emails are not task content. */
export interface MentionCandidate {
  id: string;
  name: string;
  email: string;
}

/**
 * The handle form we match against a candidate: their display name with all whitespace
 * removed, lowercased (e.g. "Noel Pollak" -> "noelpollak"), plus their email local-part
 * lowercased (e.g. "member1@halevora.com" -> "member1"). A raw `@token` in text is compared,
 * lowercased, against BOTH. The longest candidate handle that the token starts with wins, so
 * "@noelpollak" beats "@noel" when both exist — but a token only ever resolves one user.
 */
export function candidateHandles(user: MentionCandidate): string[] {
  const handles: string[] = [];
  const nameHandle = user.name.replace(/\s+/g, "").toLowerCase();
  if (nameHandle) handles.push(nameHandle);
  const local = user.email.split("@")[0]?.toLowerCase() ?? "";
  if (local && local !== nameHandle) handles.push(local);
  return handles;
}

/**
 * The characters that may follow `@` in a mention token. Letters, digits, dot, underscore,
 * and hyphen — enough for collapsed names and email local-parts, but it stops at whitespace
 * or punctuation so "@noel," and "@noel." mention "noel".
 */
const TOKEN_CHARS = /[a-z0-9._-]+/iy;

/**
 * Scan free text for `@token` runs and resolve each to a user id, against the candidate set.
 * Returns the DISTINCT set of resolved user ids (a name mentioned twice notifies once). An
 * `@token` that matches no candidate is ignored (it stays literal text). Matching is greedy
 * on the longest candidate handle that the lowercased token equals or starts with.
 *
 * This is the shared resolver for BOTH chat (raw string) and comments (after we flatten the
 * Tiptap doc to its text — see `extractMentionIdsFromDoc`).
 */
export function extractMentionIds(
  text: string,
  candidates: MentionCandidate[],
): string[] {
  if (!text || candidates.length === 0) return [];

  // Build a handle -> id index, longest handle first so greedy matching prefers the most
  // specific handle (handles are unique enough for the small team; on a tie the first wins).
  const index: { handle: string; id: string }[] = [];
  for (const c of candidates) {
    for (const h of candidateHandles(c)) index.push({ handle: h, id: c.id });
  }
  index.sort((a, b) => b.handle.length - a.handle.length);

  const found = new Set<string>();
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "@") continue;
    // A mention `@` must start the string or follow a non-word char (so "email@x" is NOT one).
    if (i > 0 && /[a-z0-9]/i.test(text[i - 1])) continue;
    TOKEN_CHARS.lastIndex = i + 1;
    const m = TOKEN_CHARS.exec(text);
    if (!m || m.index !== i + 1) continue;
    const token = m[0].toLowerCase();
    // Resolve: the longest handle that the token starts with (handles already longest-first).
    const hit = index.find((e) => token === e.handle || token.startsWith(e.handle));
    if (hit) found.add(hit.id);
  }
  return [...found];
}

/**
 * Flatten a Tiptap document to its concatenated text, then resolve mentions. The doc is
 * untrusted client JSON — we walk it defensively, only reading string `text` nodes and, if a
 * dedicated `mention` node carries a resolved id in its attrs, taking that id directly (a
 * future picker-based mention). Never throws on a malformed doc — returns [] instead.
 */
export function extractMentionIdsFromDoc(
  doc: unknown,
  candidates: MentionCandidate[],
): string[] {
  const found = new Set<string>();
  const validIds = new Set(candidates.map((c) => c.id));
  let text = "";

  function walk(node: unknown): void {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    // A structured mention node (attrs.id) resolves directly when it names a real user.
    if (n.type === "mention" && n.attrs && typeof n.attrs === "object") {
      const id = (n.attrs as Record<string, unknown>).id;
      if (typeof id === "string" && validIds.has(id)) found.add(id);
    }
    if (typeof n.text === "string") text += n.text + " ";
    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child);
    }
  }

  try {
    walk(doc);
  } catch {
    return [];
  }

  for (const id of extractMentionIds(text, candidates)) found.add(id);
  return [...found];
}
