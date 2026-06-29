/**
 * Supabase Storage glue for task attachments. Server-only.
 *
 * GRACEFUL DEGRADATION (handoff 05): `SUPABASE_SERVICE_ROLE_KEY` is NOT set in this repo.
 * Every function here detects the missing key and returns a disabled/no-op result rather
 * than throwing, so the attachments UI shows a clear "needs key" state and NEVER blocks
 * custom fields / comments / activity. If the key IS present at runtime we lazily create
 * the bucket (if missing), upload, sign download URLs, and delete.
 *
 * The service key is a SECRET: it is read from env only, used server-side only, and never
 * shipped to the client. Only the resolved public URL / short-lived signed URL crosses the
 * boundary.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_SUPABASE_URL = "https://ggpubtmydqiywxlfpckx.supabase.co";
export const ATTACHMENTS_BUCKET = "task-attachments";
const SIGNED_URL_TTL = 60 * 60; // 1 hour

/** Whether attachments are enabled — i.e. the service key is present in env. */
export function storageEnabled(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** The disabled-state message shown in the panel when the key is absent. */
export const STORAGE_DISABLED_MESSAGE =
  "Attachments need SUPABASE_SERVICE_ROLE_KEY in .env";

let cachedClient: SupabaseClient | null = null;
let bucketEnsured = false;

/** Lazily build the service-role client, or null when the key is absent. */
function getClient(): SupabaseClient | null {
  if (!storageEnabled()) return null;
  if (cachedClient) return cachedClient;
  const url = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  cachedClient = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

/** Create the attachments bucket once per process if it does not yet exist. */
async function ensureBucket(client: SupabaseClient): Promise<void> {
  if (bucketEnsured) return;
  const { data } = await client.storage.getBucket(ATTACHMENTS_BUCKET);
  if (!data) {
    await client.storage.createBucket(ATTACHMENTS_BUCKET, { public: false });
  }
  bucketEnsured = true;
}

export type StorageResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/** A storable object key for a task's attachment. Random suffix avoids collisions. */
export function objectKeyFor(taskId: string, filename: string): string {
  const safe = filename.replace(/[^\w.\-]+/g, "_").slice(0, 120);
  const rand = Math.random().toString(36).slice(2, 10);
  return `tasks/${taskId}/${Date.now()}-${rand}-${safe}`;
}

/** Upload bytes to the bucket. Returns the object key, or a disabled/error result. */
export async function uploadObject(
  key: string,
  bytes: ArrayBuffer | Buffer,
  contentType: string | undefined,
): Promise<StorageResult<string>> {
  const client = getClient();
  if (!client) return { ok: false, error: STORAGE_DISABLED_MESSAGE };
  try {
    await ensureBucket(client);
    const body =
      bytes instanceof Buffer ? bytes : Buffer.from(new Uint8Array(bytes));
    const { error } = await client.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(key, body, { contentType: contentType || undefined, upsert: false });
    if (error) return { ok: false, error: error.message };
    return { ok: true, value: key };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Upload failed." };
  }
}

/** Sign a short-lived download URL for an object key. */
export async function signedUrlFor(key: string): Promise<StorageResult<string>> {
  const client = getClient();
  if (!client) return { ok: false, error: STORAGE_DISABLED_MESSAGE };
  try {
    const { data, error } = await client.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUrl(key, SIGNED_URL_TTL);
    if (error || !data) return { ok: false, error: error?.message ?? "Could not sign URL." };
    return { ok: true, value: data.signedUrl };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not sign URL." };
  }
}

/** Delete an object key from the bucket. Best-effort; reports failures. */
export async function deleteObject(key: string): Promise<StorageResult<true>> {
  const client = getClient();
  if (!client) return { ok: false, error: STORAGE_DISABLED_MESSAGE };
  try {
    const { error } = await client.storage.from(ATTACHMENTS_BUCKET).remove([key]);
    if (error) return { ok: false, error: error.message };
    return { ok: true, value: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed." };
  }
}
