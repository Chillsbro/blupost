export const PROTOCOL_VERSION = 2;
export const MAX_ENGINE_COMMAND_BYTES = 64 * 1024;
export const MAX_ENGINE_EVENT_BYTES = 128 * 1024 * 1024;

export type ConnectionState =
  | {state: "disconnected"}
  | {state: "connecting"}
  | {state: "connected"; phone_name: string; message_type: string}
  | {state: "failed"};

export interface ContactEntry {
  alias: string;
  number: string;
}

export type MessageDirection = "incoming" | "outgoing";
export type MessageState = "received" | "sending" | "sent" | "failed" | "unknown";

export interface SessionMessage {
  id: number;
  participant: string;
  body: string;
  direction: MessageDirection;
  state: MessageState;
  unread: boolean;
}

export interface ThreadSnapshot {
  participant: string;
  unread: number;
  draft: string;
  messages: SessionMessage[];
}

export interface SessionSnapshot {
  active_thread: string | null;
  total_messages: number;
  threads: ThreadSnapshot[];
}

export interface EngineSnapshot {
  connection: ConnectionState;
  contacts: ContactEntry[];
  session: SessionSnapshot;
}

export type OperationKind =
  | "connect"
  | "send"
  | "set_active_thread"
  | "set_draft"
  | "add_contact"
  | "shutdown";

export type EngineCommand =
  | {type: "hello"; request_id: string; version: number}
  | {type: "connect"; request_id: string}
  | {type: "send"; request_id: string; recipient: string; body: string}
  | {type: "set_active_thread"; request_id: string; recipient: string}
  | {type: "set_draft"; request_id: string; recipient: string; body: string}
  | {type: "add_contact"; request_id: string; alias: string; number: string}
  | {type: "shutdown"; request_id: string};

export type EngineEvent =
  | {type: "ready"; version: number; request_id: string}
  | {type: "snapshot"; snapshot: EngineSnapshot}
  | {
      type: "operation";
      request_id: string;
      operation: OperationKind;
      ok: boolean;
    }
  | {type: "error"; request_id: string; code: string; message: string};

export const emptySnapshot = (): EngineSnapshot => ({
  connection: {state: "disconnected"},
  contacts: [],
  session: {active_thread: null, total_messages: 0, threads: []}
});

export function decodeEngineEvent(line: string): EngineEvent {
  if (Buffer.byteLength(line) > MAX_ENGINE_EVENT_BYTES) {
    throw new Error("engine protocol frame is too large");
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error("engine protocol frame is not valid JSON");
  }
  if (!value || typeof value !== "object" || !("type" in value)) {
    throw new Error("engine protocol frame has no event type");
  }
  const type = (value as {type?: unknown}).type;
  if (!["ready", "snapshot", "operation", "error"].includes(String(type))) {
    throw new Error("engine protocol frame has an unknown event type");
  }
  if (!isEngineEvent(value)) {
    throw new Error("engine protocol frame does not match its event schema");
  }
  return value;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: JsonRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isConnectionState(value: unknown): value is ConnectionState {
  if (!isRecord(value) || typeof value.state !== "string") return false;
  if (["disconnected", "connecting", "failed"].includes(value.state)) {
    return hasExactKeys(value, ["state"]);
  }
  return (
    value.state === "connected" &&
    hasExactKeys(value, ["state", "phone_name", "message_type"]) &&
    typeof value.phone_name === "string" &&
    typeof value.message_type === "string"
  );
}

function isContact(value: unknown): value is ContactEntry {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["alias", "number"]) &&
    typeof value.alias === "string" &&
    typeof value.number === "string"
  );
}

function isSessionMessage(value: unknown): value is SessionMessage {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "id",
      "participant",
      "body",
      "direction",
      "state",
      "unread"
    ]) &&
    isNonNegativeInteger(value.id) &&
    typeof value.participant === "string" &&
    typeof value.body === "string" &&
    (value.direction === "incoming" || value.direction === "outgoing") &&
    ["received", "sending", "sent", "failed", "unknown"].includes(
      String(value.state)
    ) &&
    typeof value.unread === "boolean"
  );
}

function isThread(value: unknown): value is ThreadSnapshot {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["participant", "unread", "draft", "messages"]) &&
    typeof value.participant === "string" &&
    isNonNegativeInteger(value.unread) &&
    typeof value.draft === "string" &&
    Array.isArray(value.messages) &&
    value.messages.every(isSessionMessage)
  );
}

function isSnapshot(value: unknown): value is EngineSnapshot {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["connection", "contacts", "session"]) ||
    !isConnectionState(value.connection)
  ) {
    return false;
  }
  if (!Array.isArray(value.contacts) || !value.contacts.every(isContact)) return false;
  const session = value.session;
  return (
    isRecord(session) &&
    hasExactKeys(session, ["active_thread", "total_messages", "threads"]) &&
    (session.active_thread === null || typeof session.active_thread === "string") &&
    isNonNegativeInteger(session.total_messages) &&
    Array.isArray(session.threads) &&
    session.threads.every(isThread)
  );
}

function isEngineEvent(value: unknown): value is EngineEvent {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "ready":
      return (
        hasExactKeys(value, ["type", "version", "request_id"]) &&
        isNonNegativeInteger(value.version) &&
        typeof value.request_id === "string"
      );
    case "snapshot":
      return hasExactKeys(value, ["type", "snapshot"]) && isSnapshot(value.snapshot);
    case "operation":
      return (
        hasExactKeys(value, ["type", "request_id", "operation", "ok"]) &&
        typeof value.request_id === "string" &&
        [
          "connect",
          "send",
          "set_active_thread",
          "set_draft",
          "add_contact",
          "shutdown"
        ].includes(String(value.operation)) &&
        typeof value.ok === "boolean"
      );
    case "error":
      return (
        hasExactKeys(value, ["type", "request_id", "code", "message"]) &&
        typeof value.request_id === "string" &&
        typeof value.code === "string" &&
        typeof value.message === "string"
      );
    default:
      return false;
  }
}
