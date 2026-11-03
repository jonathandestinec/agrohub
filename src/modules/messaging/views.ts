import type { MessageSide, ThreadKind } from "@/generated/prisma/client";
import type { Role } from "@/modules/identity/policies";

// Thread rows as THREAD_INCLUDE (service.ts) loads them. Names are resolved to labels here, per
// viewer: a buyer sees every cooperative-side author as the cooperative, never an officer.
export type ThreadRow = {
  id: string;
  kind: ThreadKind;
  lot: { id: string; crop: { name: string }; unit: { name: string } };
  cooperative: { name: string };
  counterpart: { name: string };
  lastMessageAt: Date;
};

export type MessageRow = {
  id: string;
  authorUserId: string;
  author: { name: string };
  side: MessageSide;
  body: string;
  createdAt: Date;
};

export type ThreadMessage = {
  id: string;
  side: MessageSide;
  author: string;
  body: string;
  createdAt: string;
  mine: boolean;
};

export type ThreadView = {
  id: string;
  kind: ThreadKind;
  lot: { id: string; crop: string; unit: string };
  title: string;
  messages: ThreadMessage[];
};

export type ThreadSummary = {
  id: string;
  kind: ThreadKind;
  lot: { id: string; crop: string; unit: string };
  title: string;
  lastMessageAt: string;
  lastMessage: string;
};

export const AGROHUB = "AgroHub";

type Viewer = { userId: string; role: Role };

// Buyers and farmers talk to "the cooperative"; officers and admins see who they talk to.
function titleFor(thread: ThreadRow, viewer: Viewer): string {
  return viewer.role === "BUYER" || viewer.role === "FARMER" ? thread.cooperative.name : thread.counterpart.name;
}

function authorFor(message: MessageRow, thread: ThreadRow, viewer: Viewer): string {
  if (message.side === "ADMIN") return AGROHUB;
  if (message.side === "COOPERATIVE" && viewer.role === "BUYER") return thread.cooperative.name;
  return message.author.name;
}

function lotOf(thread: ThreadRow): { id: string; crop: string; unit: string } {
  return { id: thread.lot.id, crop: thread.lot.crop.name, unit: thread.lot.unit.name };
}

export function toThreadView(thread: ThreadRow, messages: MessageRow[], viewer: Viewer): ThreadView {
  return {
    id: thread.id,
    kind: thread.kind,
    lot: lotOf(thread),
    title: titleFor(thread, viewer),
    messages: messages.map((message) => ({
      id: message.id,
      side: message.side,
      author: authorFor(message, thread, viewer),
      body: message.body,
      createdAt: message.createdAt.toISOString(),
      mine: message.authorUserId === viewer.userId,
    })),
  };
}

export function toThreadSummary(thread: ThreadRow, last: { body: string } | undefined, viewer: Viewer): ThreadSummary {
  return {
    id: thread.id,
    kind: thread.kind,
    lot: lotOf(thread),
    title: titleFor(thread, viewer),
    lastMessageAt: thread.lastMessageAt.toISOString(),
    lastMessage: last?.body ?? "",
  };
}
