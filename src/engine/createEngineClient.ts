import {exists} from "node:fs/promises";
import {basename, dirname, resolve} from "node:path";
import {
  decodeEngineEvent,
  type EngineCommand,
  type EngineEvent,
  MAX_ENGINE_COMMAND_BYTES,
  MAX_ENGINE_EVENT_BYTES,
  type OperationKind,
  PROTOCOL_VERSION
} from "../protocol.js";

export type EngineListener = (event: EngineEvent) => void;

export interface EngineClient {
  subscribe(listener: EngineListener): () => void;
  start(): Promise<void>;
  connect(): Promise<void>;
  addContact(alias: string, number: string): Promise<void>;
  sendMessage(recipient: string, body: string): Promise<void>;
  setActiveThread(recipient: string): Promise<void>;
  setDraft(recipient: string, body: string): Promise<void>;
  stop(): Promise<void>;
}

interface PendingRequest {
  expected: {type: "ready"} | {type: "operation"; operation: OperationKind};
  resolve: () => void;
  reject: (error: Error) => void;
}

const ENGINE_SHUTDOWN_TIMEOUT_MS = 42_000;
const ENGINE_EXIT_TIMEOUT_MS = 2_000;

class DeadlineExceededError extends Error {}

function isAsyncEngineNotice(event: Extract<EngineEvent, {type: "error"}>): boolean {
  return (
    (event.request_id === "phone-event" &&
      ["phone_event_failed", "incoming_skipped"].includes(event.code)) ||
    (/^auto-reconnect-[1-3]$/.test(event.request_id) &&
      event.code === "reconnect_failed")
  );
}

function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string
): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(
      () => rejectPromise(new DeadlineExceededError(message)),
      milliseconds
    );
    promise.then(
      value => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      error => {
        clearTimeout(timer);
        rejectPromise(error);
      }
    );
  });
}

export async function resolveEngineBinary(): Promise<string> {
  const configured = process.env.BLUPOST_ENGINE;
  if (configured) return configured;

  const sourceModule =
    basename(import.meta.dir) === "engine" &&
    basename(dirname(import.meta.dir)) === "src";
  const packageRoot = sourceModule
    ? resolve(import.meta.dir, "../..")
    : resolve(import.meta.dir, "..");
  const debugBinary = resolve(packageRoot, "target/debug/blupost-engine");
  const releaseBinary = resolve(packageRoot, "target/release/blupost-engine");
  const candidates = [releaseBinary, debugBinary];
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  const installed = Bun.which("blupost-engine");
  if (installed) return installed;
  throw new Error(
    "blupost-engine was not found; run `bun run build:engine` or set BLUPOST_ENGINE"
  );
}

class ChildProcessEngineClient implements EngineClient {
  private listeners = new Set<EngineListener>();
  private pending = new Map<string, PendingRequest>();
  private process: Bun.Subprocess<"pipe", "pipe", "inherit"> | undefined;
  private readTask: Promise<void> | undefined;
  private startTask: Promise<void> | undefined;
  private stopTask: Promise<void> | undefined;
  private protocolFailure: Error | undefined;
  private stopped = false;
  private nextRequestSequence = 0;

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): Promise<void> {
    if (this.stopped) return Promise.reject(new Error("engine process has stopped"));
    this.startTask ??= this.performStart();
    return this.startTask;
  }

  private async performStart(): Promise<void> {
    const binary = await resolveEngineBinary();
    if (this.stopped) throw new Error("engine process has stopped");
    this.process = Bun.spawn({
      cmd: [binary, "serve"],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit"
    });
    this.readTask = this.readEvents(this.process.stdout);
    await this.request({
      type: "hello",
      request_id: this.requestId(),
      version: PROTOCOL_VERSION
    });
    if (this.stopped) throw new Error("engine process has stopped");
  }

  connect(): Promise<void> {
    return this.request({type: "connect", request_id: this.requestId()});
  }

  addContact(alias: string, number: string): Promise<void> {
    return this.request({
      type: "add_contact",
      request_id: this.requestId(),
      alias,
      number
    });
  }

  sendMessage(recipient: string, body: string): Promise<void> {
    return this.request({
      type: "send",
      request_id: this.requestId(),
      recipient,
      body
    });
  }

  setActiveThread(recipient: string): Promise<void> {
    return this.request({
      type: "set_active_thread",
      request_id: this.requestId(),
      recipient
    });
  }

  setDraft(recipient: string, body: string): Promise<void> {
    return this.request({
      type: "set_draft",
      request_id: this.requestId(),
      recipient,
      body
    });
  }

  stop(): Promise<void> {
    this.stopped = true;
    this.stopTask ??= this.performStop();
    return this.stopTask;
  }

  private async performStop(): Promise<void> {
    const child = this.process;
    if (!child) return;
    try {
      await withTimeout(
        this.request({type: "shutdown", request_id: this.requestId()}),
        ENGINE_SHUTDOWN_TIMEOUT_MS,
        "engine shutdown timed out"
      );
    } catch (error) {
      if (error instanceof DeadlineExceededError) child.kill();
    }
    try {
      child.stdin.end();
    } catch {
      child.kill();
    }
    await Promise.race([
      child.exited,
      new Promise<void>(resolveWait => setTimeout(resolveWait, ENGINE_EXIT_TIMEOUT_MS))
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
    if (this.readTask) {
      await withTimeout(
        this.readTask.catch(() => undefined),
        ENGINE_EXIT_TIMEOUT_MS,
        "engine reader shutdown timed out"
      ).catch(() => undefined);
    }
    const stopped = new Error("engine process stopped");
    for (const request of this.pending.values()) request.reject(stopped);
    this.pending.clear();
    this.process = undefined;
  }

  private async request(command: EngineCommand): Promise<void> {
    if (this.protocolFailure) throw this.protocolFailure;
    const child = this.process;
    if (!child) throw new Error("engine process has not started");
    if (this.stopped && command.type !== "shutdown") {
      throw new Error("engine process has stopped");
    }
    const frame = `${JSON.stringify(command)}\n`;
    if (Buffer.byteLength(frame) > MAX_ENGINE_COMMAND_BYTES) {
      throw new Error("engine command exceeds the protocol frame limit");
    }
    const completion = new Promise<void>((resolveRequest, rejectRequest) => {
      this.pending.set(command.request_id, {
        expected:
          command.type === "hello"
            ? {type: "ready"}
            : {type: "operation", operation: command.type},
        resolve: resolveRequest,
        reject: rejectRequest
      });
    });
    try {
      child.stdin.write(frame);
      await child.stdin.flush();
    } catch (error) {
      this.pending.delete(command.request_id);
      throw error;
    }
    return completion;
  }

  private requestId(): string {
    this.nextRequestSequence += 1;
    return String(this.nextRequestSequence);
  }

  private async readEvents(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, {stream: true});
        let newline = buffered.indexOf("\n");
        while (newline >= 0) {
          const line = buffered.slice(0, newline).trimEnd();
          buffered = buffered.slice(newline + 1);
          if (line) this.accept(decodeEngineEvent(line));
          newline = buffered.indexOf("\n");
        }
        if (Buffer.byteLength(buffered) > MAX_ENGINE_EVENT_BYTES) {
          throw new Error("engine protocol buffer exceeded its limit");
        }
      }
      if (this.pending.size > 0 || !this.stopped) {
        throw new Error("engine process closed unexpectedly");
      }
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.protocolFailure ??= failure;
      for (const request of this.pending.values()) request.reject(failure);
      this.pending.clear();
      const child = this.process;
      if (child) {
        try {
          child.stdin.end();
        } catch {
          // The process is already unusable after a protocol failure.
        }
        if (child.exitCode === null) child.kill();
      }
      if (!this.stopped) {
        this.emit({
          type: "error",
          request_id: "engine-process",
          code: "engine_process",
          message: failure.message
        });
      }
    } finally {
      reader.releaseLock();
    }
  }

  private accept(event: EngineEvent): void {
    if (event.type === "snapshot") {
      this.emit(event);
      return;
    }
    const pending = this.pending.get(event.request_id);
    if (event.type === "error") {
      if (pending) {
        if (pending.expected.type === "ready") {
          throw new Error(event.message);
        }
        this.pending.delete(event.request_id);
        pending.reject(new Error(event.message));
        return;
      }
      if (!isAsyncEngineNotice(event)) {
        throw new Error("engine returned an uncorrelated error response");
      }
      this.emit(event);
      return;
    }
    if (!pending) {
      throw new Error("engine returned an uncorrelated response");
    }
    if (event.type === "ready") {
      if (pending.expected.type !== "ready") {
        throw new Error("engine returned ready for the wrong request kind");
      }
      if (event.version !== PROTOCOL_VERSION) {
        throw new Error("engine protocol version does not match the frontend");
      }
      this.pending.delete(event.request_id);
      this.emit(event);
      pending.resolve();
      return;
    }
    if (
      pending.expected.type !== "operation" ||
      pending.expected.operation !== event.operation
    ) {
      throw new Error("engine returned the wrong operation for a request");
    }
    this.pending.delete(event.request_id);
    this.emit(event);
    if (!event.ok) {
      pending.reject(new Error(`${event.operation} failed`));
    } else {
      pending.resolve();
    }
  }

  private emit(event: EngineEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

export function createEngineClient(): EngineClient {
  return new ChildProcessEngineClient();
}
