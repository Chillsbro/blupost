import {expect, test} from "bun:test";
import {decodeEngineEvent, MAX_ENGINE_COMMAND_BYTES} from "../../src/protocol.js";

test("decodes a versioned engine event", () => {
  expect(
    decodeEngineEvent('{"type":"ready","version":2,"request_id":"hello"}')
  ).toEqual({type: "ready", version: 2, request_id: "hello"});
});

test("accepts an add-contact operation result", () => {
  expect(
    decodeEngineEvent(
      '{"type":"operation","request_id":"2","operation":"add_contact","ok":true}'
    )
  ).toEqual({
    type: "operation",
    request_id: "2",
    operation: "add_contact",
    ok: true
  });
});

test("rejects an unknown engine event", () => {
  expect(() => decodeEngineEvent('{"type":"raw_obex_message"}')).toThrow(
    "unknown event type"
  );
});

test("rejects a known event whose nested shape is incomplete", () => {
  expect(() => decodeEngineEvent('{"type":"snapshot","snapshot":{}}')).toThrow(
    "does not match its event schema"
  );
});

test("rejects unknown fields instead of silently widening the protocol", () => {
  expect(() =>
    decodeEngineEvent(
      '{"type":"ready","version":2,"request_id":"hello","unexpected":true}'
    )
  ).toThrow("does not match its event schema");
});

test("accepts a bounded full snapshot larger than the command frame limit", () => {
  const participant = "+12025550101";
  const messages = Array.from({length: 500}, (_, index) => ({
    id: index + 1,
    participant,
    body: "x".repeat(160),
    direction: index % 2 === 0 ? "incoming" : "outgoing",
    state: index % 2 === 0 ? "received" : "sent",
    unread: false
  }));
  const frame = JSON.stringify({
    type: "snapshot",
    snapshot: {
      connection: {
        state: "connected",
        phone_name: "Test iPhone",
        message_type: "SMS_GSM"
      },
      contacts: [],
      session: {
        active_thread: participant,
        total_messages: messages.length,
        threads: [{participant, unread: 0, draft: "", messages}]
      }
    }
  });

  expect(Buffer.byteLength(frame)).toBeGreaterThan(MAX_ENGINE_COMMAND_BYTES);
  expect(decodeEngineEvent(frame).type).toBe("snapshot");
});
