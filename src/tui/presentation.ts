import type {EngineSnapshot, MessageState, SessionMessage} from "../protocol.js";

export type PresentationTone = "muted" | "success" | "warning" | "error";

export interface ConnectionPresentation {
  label: string;
  tone: PresentationTone;
  isConnected: boolean;
  isConnecting: boolean;
  canReconnect: boolean;
}

export interface ConversationPresentation {
  number: string;
  label: string;
  preview: string;
  unread: number;
  hasDraft: boolean;
  draft: string;
}

export interface MessagePresentation {
  id: number;
  body: string;
  state: MessageState;
  outcome: string | null;
  outcomeTone: PresentationTone;
}

export interface MessageGroupPresentation {
  direction: "incoming" | "outgoing";
  messages: MessagePresentation[];
}

export interface ActiveConversationPresentation extends ConversationPresentation {
  groups: MessageGroupPresentation[];
}

export interface BlupostPresentation {
  connection: ConnectionPresentation;
  conversations: ConversationPresentation[];
  activeConversation: ActiveConversationPresentation | null;
}

function presentConnection(snapshot: EngineSnapshot): ConnectionPresentation {
  switch (snapshot.connection.state) {
    case "connected":
      return {
        label: "connected",
        tone: "success",
        isConnected: true,
        isConnecting: false,
        canReconnect: false
      };
    case "connecting":
      return {
        label: "connecting…",
        tone: "warning",
        isConnected: false,
        isConnecting: true,
        canReconnect: false
      };
    case "failed":
      return {
        label: "connection failed",
        tone: "error",
        isConnected: false,
        isConnecting: false,
        canReconnect: true
      };
    case "disconnected":
      return {
        label: "offline",
        tone: "warning",
        isConnected: false,
        isConnecting: false,
        canReconnect: true
      };
  }
}

function presentOutcome(message: SessionMessage): {
  outcome: string | null;
  outcomeTone: PresentationTone;
} {
  switch (message.state) {
    case "received":
      return {outcome: null, outcomeTone: "muted"};
    case "sending":
      return {outcome: "sending…", outcomeTone: "muted"};
    case "sent":
      return {outcome: "✓", outcomeTone: "muted"};
    case "failed":
      return {outcome: "not sent", outcomeTone: "error"};
    case "unknown":
      return {
        outcome: "Check your phone — outcome unknown",
        outcomeTone: "warning"
      };
  }
}

function presentMessage(message: SessionMessage): MessagePresentation {
  return {
    id: message.id,
    body: message.body,
    state: message.state,
    ...presentOutcome(message)
  };
}

function groupMessages(messages: SessionMessage[]): MessageGroupPresentation[] {
  const groups: MessageGroupPresentation[] = [];
  for (const message of messages) {
    const latest = groups.at(-1);
    if (!latest || latest.direction !== message.direction) {
      groups.push({
        direction: message.direction,
        messages: [presentMessage(message)]
      });
      continue;
    }
    latest.messages.push(presentMessage(message));
  }
  return groups;
}

/**
 * Produces the complete, protocol-truthful view model for a renderer.
 * Contact ordering, message grouping, and user-facing state language stay local here.
 */
export function createBlupostPresentation(
  snapshot: EngineSnapshot
): BlupostPresentation {
  const labels = new Map<string, string>();
  for (const contact of snapshot.contacts) labels.set(contact.number, contact.alias);
  for (const thread of snapshot.session.threads) {
    if (!labels.has(thread.participant)) {
      labels.set(thread.participant, thread.participant);
    }
  }

  const conversations = [...labels].map(([number, label]) => {
    const thread = snapshot.session.threads.find(
      candidate => candidate.participant === number
    );
    const latestMessage = thread?.messages.at(-1);
    return {
      number,
      label,
      preview: latestMessage?.body ?? "",
      unread: thread?.unread ?? 0,
      hasDraft: Boolean(thread?.draft.trim()),
      draft: thread?.draft ?? ""
    } satisfies ConversationPresentation;
  });

  const activeNumber = snapshot.session.active_thread;
  const activeBase = activeNumber
    ? conversations.find(conversation => conversation.number === activeNumber)
    : undefined;
  const activeThread = activeNumber
    ? snapshot.session.threads.find(thread => thread.participant === activeNumber)
    : undefined;
  const activeConversation =
    activeNumber && activeBase
      ? {
          ...activeBase,
          groups: groupMessages(activeThread?.messages ?? [])
        }
      : null;

  return {
    connection: presentConnection(snapshot),
    conversations,
    activeConversation
  };
}
