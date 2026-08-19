import type {
  EngineClient,
  EngineListener
} from "../../src/engine/createEngineClient.js";
import {
  type EngineEvent,
  type EngineSnapshot,
  emptySnapshot,
  PROTOCOL_VERSION
} from "../../src/protocol.js";

/**
 * Records UI intent without reproducing Rust session or transport policy.
 * Tests publish snapshots explicitly whenever authoritative engine state changes.
 */
export class RecordingEngineClient implements EngineClient {
  readonly addedContacts: Array<{alias: string; number: string}> = [];
  readonly sends: Array<{recipient: string; body: string}> = [];
  readonly selectedThreads: string[] = [];
  readonly draftUpdates: Array<{recipient: string; body: string}> = [];
  connectCount = 0;
  stopCount = 0;
  stopBarrier: Promise<void> | undefined;
  sendBarrier: Promise<void> | undefined;
  addContactBarrier: Promise<void> | undefined;
  sendError: Error | undefined;
  addContactError: Error | undefined;
  private listeners = new Set<EngineListener>();

  constructor(public snapshot: EngineSnapshot = emptySnapshot()) {}

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    this.emitSnapshot();
    this.emit({type: "ready", version: PROTOCOL_VERSION, request_id: "recording"});
  }

  async connect(): Promise<void> {
    this.connectCount += 1;
  }

  async addContact(alias: string, number: string): Promise<void> {
    this.addedContacts.push({alias, number});
    await this.addContactBarrier;
    if (this.addContactError) throw this.addContactError;
  }

  async sendMessage(recipient: string, body: string): Promise<void> {
    this.sends.push({recipient, body});
    await this.sendBarrier;
    if (this.sendError) throw this.sendError;
  }

  async setActiveThread(recipient: string): Promise<void> {
    this.selectedThreads.push(recipient);
  }

  async setDraft(recipient: string, body: string): Promise<void> {
    this.draftUpdates.push({recipient, body});
  }

  async stop(): Promise<void> {
    this.stopCount += 1;
    await this.stopBarrier;
  }

  emitSnapshot(snapshot: EngineSnapshot = this.snapshot): void {
    this.snapshot = snapshot;
    this.emit({type: "snapshot", snapshot});
  }

  emit(event: EngineEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
