import type {EngineSnapshot, MessageState, SessionMessage} from "../protocol.js";

export type PresentationTone = "muted" | "success" | "warning" | "error";

export interface ConnectionPresentation {
  label: string;
  compactLabel: string;
  tone: PresentationTone;
  isConnected: boolean;
  isConnecting: boolean;
  canReconnect: boolean;
}

export interface ConversationPresentation {
  number: string;
  label: string;
  unread: number;
  hasDraft: boolean;
  draft: string;
  preview: string | null;
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
  label: string;
  messages: MessagePresentation[];
}

export interface ActiveConversationPresentation extends ConversationPresentation {
  groups: MessageGroupPresentation[];
}

export interface BlupostPresentation {
  connection: ConnectionPresentation;
  conversations: ConversationPresentation[];
  activeConversation: ActiveConversationPresentation | null;
  sessionMessageCount: number;
}

function presentConnection(
  snapshot: EngineSnapshot,
  spinner: string
): ConnectionPresentation {
  switch (snapshot.connection.state) {
    case "connected":
      return {
        label: `● Connected · ${snapshot.connection.phone_name}`,
        compactLabel: "● Connected",
        tone: "success",
        isConnected: true,
        isConnecting: false,
        canReconnect: false
      };
    case "connecting":
      return {
        label: `${spinner} Connecting…`,
        compactLabel: `${spinner} Connecting…`,
        tone: "warning",
        isConnected: false,
        isConnecting: true,
        canReconnect: false
      };
    case "failed":
      return {
        label: "! Connection failed",
        compactLabel: "! Failed",
        tone: "error",
        isConnected: false,
        isConnecting: false,
        canReconnect: true
      };
    case "disconnected":
      return {
        label: "○ Disconnected",
        compactLabel: "○ Disconnected",
        tone: "warning",
        isConnected: false,
        isConnecting: false,
        canReconnect: true
      };
  }
}

function presentOutcome(
  message: SessionMessage,
  sendingSpinner: string
): {
  outcome: string | null;
  outcomeTone: PresentationTone;
} {
  switch (message.state) {
    case "received":
      return {outcome: null, outcomeTone: "muted"};
    case "sending":
      return {outcome: `${sendingSpinner} Sending…`, outcomeTone: "muted"};
    case "sent":
      return {outcome: "✓ Sent", outcomeTone: "muted"};
    case "failed":
      return {outcome: "! Not sent", outcomeTone: "error"};
    case "unknown":
      return {
        outcome: "? Check your phone — outcome unknown",
        outcomeTone: "warning"
      };
  }
}

function presentMessage(
  message: SessionMessage,
  sendingSpinner: string
): MessagePresentation {
  return {
    id: message.id,
    body: message.body,
    state: message.state,
    ...presentOutcome(message, sendingSpinner)
  };
}

function groupMessages(
  messages: SessionMessage[],
  incomingLabel: string,
  sendingSpinner: string
): MessageGroupPresentation[] {
  const groups: MessageGroupPresentation[] = [];
  for (const message of messages) {
    const latest = groups.at(-1);
    if (!latest || latest.direction !== message.direction) {
      groups.push({
        direction: message.direction,
        label: message.direction === "outgoing" ? "You" : incomingLabel,
        messages: [presentMessage(message, sendingSpinner)]
      });
      continue;
    }
    latest.messages.push(presentMessage(message, sendingSpinner));
  }
  return groups;
}

function previewOf(messages: SessionMessage[]): string | null {
  const body = messages.at(-1)?.body.replace(/\s+/gu, " ").trim();
  return body ? body : null;
}

/**
 * Produces the complete, protocol-truthful view model for a renderer.
 * Contact ordering, message grouping, and user-facing state language stay local here.
 */
export function createBlupostPresentation(
  snapshot: EngineSnapshot,
  connectionSpinner: string,
  sendingSpinner = "◌"
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
    return {
      number,
      label,
      unread: thread?.unread ?? 0,
      hasDraft: Boolean(thread?.draft.trim()),
      draft: thread?.draft ?? "",
      preview: previewOf(thread?.messages ?? [])
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
          groups: groupMessages(
            activeThread?.messages ?? [],
            activeBase.label,
            sendingSpinner
          )
        }
      : null;

  return {
    connection: presentConnection(snapshot, connectionSpinner),
    conversations,
    activeConversation,
    sessionMessageCount: snapshot.session.total_messages
  };
}
