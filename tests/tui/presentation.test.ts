import {expect, test} from "bun:test";
import type {EngineSnapshot} from "../../src/protocol.js";
import {createBlupostPresentation} from "../../src/tui/presentation.js";

function fixture(): EngineSnapshot {
  return {
    connection: {
      state: "connected",
      phone_name: "Fixture phone",
      message_type: "SMS_GSM"
    },
    contacts: [
      {alias: "alice", number: "+12025550101"},
      {alias: "bob", number: "+12025550102"}
    ],
    session: {
      active_thread: "+12025550101",
      total_messages: 5,
      threads: [
        {
          participant: "+12025550101",
          unread: 2,
          draft: "unfinished",
          messages: [
            {
              id: 1,
              participant: "+12025550101",
              body: "First incoming",
              direction: "incoming",
              state: "received",
              unread: false
            },
            {
              id: 2,
              participant: "+12025550101",
              body: "Second incoming",
              direction: "incoming",
              state: "received",
              unread: false
            },
            {
              id: 3,
              participant: "+12025550101",
              body: "Confirmed outgoing",
              direction: "outgoing",
              state: "sent",
              unread: false
            },
            {
              id: 4,
              participant: "+12025550101",
              body: "Indeterminate outgoing",
              direction: "outgoing",
              state: "unknown",
              unread: false
            }
          ]
        },
        {
          participant: "+12025550199",
          unread: 0,
          draft: "",
          messages: [
            {
              id: 5,
              participant: "+12025550199",
              body: "Unknown participant",
              direction: "incoming",
              state: "received",
              unread: false
            }
          ]
        }
      ]
    }
  };
}

test("builds stable conversation rows without inventing history metadata", () => {
  const presentation = createBlupostPresentation(fixture());

  expect(presentation.conversations.map(item => item.label)).toEqual([
    "alice",
    "bob",
    "+12025550199"
  ]);
  expect(presentation.conversations[0]).toMatchObject({
    preview: "Indeterminate outgoing",
    unread: 2,
    hasDraft: true
  });
  expect(presentation.conversations[1]).toMatchObject({
    preview: "",
    unread: 0,
    hasDraft: false
  });
});

test("groups adjacent directions and keeps outcome language message-local", () => {
  const presentation = createBlupostPresentation(fixture());

  expect(presentation.activeConversation?.label).toBe("alice");
  expect(presentation.activeConversation?.groups).toHaveLength(2);
  expect(presentation.activeConversation?.groups[0]).toMatchObject({
    direction: "incoming"
  });
  expect(presentation.activeConversation?.groups[0]?.messages).toHaveLength(2);
  expect(presentation.activeConversation?.groups[1]).toMatchObject({
    direction: "outgoing"
  });
  expect(presentation.activeConversation?.groups[1]?.messages[0]?.outcome).toBe("✓");
  expect(presentation.activeConversation?.groups[1]?.messages[0]).toMatchObject({
    state: "sent",
    outcomeTone: "muted"
  });
  expect(presentation.activeConversation?.groups[1]?.messages[1]?.outcome).toBe(
    "Check your phone — outcome unknown"
  );
});

test("derives truthful connection labels and reconnect capability", () => {
  const connected = createBlupostPresentation(fixture());
  expect(connected.connection).toMatchObject({
    label: "connected",
    canReconnect: false,
    isConnected: true
  });

  const disconnectedFixture = fixture();
  disconnectedFixture.connection = {state: "disconnected"};
  const disconnected = createBlupostPresentation(disconnectedFixture);
  expect(disconnected.connection).toMatchObject({
    label: "offline",
    canReconnect: true,
    isConnected: false
  });
});
