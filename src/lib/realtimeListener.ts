/**
 * Realtime LISTEN side — the single in-process Postgres listener + SSE fan-out hub.
 * Server-only, Node runtime (a raw `pg` socket; not Edge).
 *
 * THE load-bearing infra decision (handoff 00 §2): the LISTEN worker MUST use the
 * DIRECT/session connection (`DIRECT_URL`, port 5432). Supabase's transaction pooler
 * (`DATABASE_URL`, 6543) CANNOT hold a LISTEN — a pooled listener silently never receives
 * notifications. So this module connects with its OWN `pg.Client` on `DIRECT_URL`, NOT Prisma
 * (which is pooled and is reserved for normal queries + the NOTIFY publish path).
 *
 * Design: ONE listener per server process. Subscribers (one per open SSE connection) register a
 * callback for a board channel; we ref-count `LISTEN board_<id>` and only `UNLISTEN` when the
 * last subscriber for that channel drops. The raw NOTIFY payload is decoded defensively (bad
 * payloads dropped) and handed to each subscriber's callback. Per-subscriber AUTHORIZATION
 * happens in the SSE route (re-query under scope) — this hub only routes by channel.
 *
 * The client is reused across Next.js hot reloads via a global, like src/lib/prisma.ts, so we
 * never leak a second socket. Reconnect: on connection error we mark the client dead and
 * lazily reconnect on the next subscribe, re-issuing LISTEN for every still-subscribed channel.
 */
import { Client } from "pg";
import {
  boardChannel,
  userChannel,
  decodeEvent,
  type RealtimeEvent,
} from "@/domain/realtime";

type Subscriber = (event: RealtimeEvent) => void;

interface Hub {
  client: Client | null;
  connecting: Promise<void> | null;
  /** channel -> set of subscriber callbacks currently listening on it */
  channels: Map<string, Set<Subscriber>>;
}

const globalForHub = globalThis as unknown as { __rtHub?: Hub };

function hub(): Hub {
  if (!globalForHub.__rtHub) {
    globalForHub.__rtHub = { client: null, connecting: null, channels: new Map() };
  }
  return globalForHub.__rtHub;
}

/** The direct/session connection string — the ONLY connection that may LISTEN on Supabase. */
function directUrl(): string {
  const url = process.env.DIRECT_URL;
  if (!url) throw new Error("DIRECT_URL is not set — the LISTEN worker needs the session pooler.");
  return url;
}

/** Dispatch a raw NOTIFY to the subscribers of its channel. Defensive: a bad payload is dropped. */
function dispatch(channel: string, payload: string | undefined): void {
  const subs = hub().channels.get(channel);
  if (!subs || subs.size === 0) return;
  const event = decodeEvent(payload ?? "");
  if (!event) return;
  for (const sub of subs) {
    try {
      sub(event);
    } catch {
      // A single failing subscriber must not break delivery to the others.
    }
  }
}

/** Establish (or reuse) the singleton direct-connection listener. Idempotent + reconnect-safe. */
async function ensureClient(): Promise<Client> {
  const h = hub();
  if (h.client) return h.client;
  if (h.connecting) {
    await h.connecting;
    if (h.client) return h.client;
  }

  h.connecting = (async () => {
    const client = new Client({ connectionString: directUrl() });
    client.on("notification", (msg) => dispatch(msg.channel, msg.payload));
    client.on("error", () => {
      // Mark dead; the next subscribe() will reconnect and re-LISTEN all live channels.
      if (h.client === client) h.client = null;
    });
    await client.connect();
    h.client = client;
    // Re-issue LISTEN for every channel that still has subscribers (covers a reconnect).
    for (const channel of h.channels.keys()) {
      await client.query(`LISTEN "${channel}"`);
    }
  })();

  try {
    await h.connecting;
  } finally {
    h.connecting = null;
  }
  if (!h.client) throw new Error("Realtime listener failed to connect.");
  return h.client;
}

/**
 * Subscribe a callback to a raw channel. Ref-counts LISTEN: the first subscriber issues
 * `LISTEN <channel>`; later ones just join the set. Returns an unsubscribe function that
 * removes the callback and `UNLISTEN`s when the channel has no subscribers left.
 *
 * NOTE: this routes by channel only. The SSE route MUST still authorize each event for the
 * specific subscriber (re-query under scope / recipient check) before writing it to that
 * client's stream. The channel name shape is validated by construction (board_<cuid> /
 * user_<cuid>), so quoting the identifier is safe.
 */
async function subscribeChannel(
  channel: string,
  onEvent: Subscriber,
): Promise<() => void> {
  const h = hub();
  const client = await ensureClient();

  let subs = h.channels.get(channel);
  const isFirst = !subs || subs.size === 0;
  if (!subs) {
    subs = new Set();
    h.channels.set(channel, subs);
  }
  subs.add(onEvent);
  if (isFirst) {
    await client.query(`LISTEN "${channel}"`);
  }

  return () => {
    const set = h.channels.get(channel);
    if (!set) return;
    set.delete(onEvent);
    if (set.size === 0) {
      h.channels.delete(channel);
      // Best-effort UNLISTEN; if the socket is already gone the channel map is what matters.
      h.client?.query(`UNLISTEN "${channel}"`).catch(() => {});
    }
  };
}

/** Subscribe to a board's chat/presence/task-liveness channel. */
export async function subscribeBoard(
  boardId: string,
  onEvent: Subscriber,
): Promise<() => void> {
  return subscribeChannel(boardChannel(boardId), onEvent);
}

/** Subscribe to a user's OWN notification channel (Section 12, user-targeted delivery). */
export async function subscribeUser(
  userId: string,
  onEvent: Subscriber,
): Promise<() => void> {
  return subscribeChannel(userChannel(userId), onEvent);
}
