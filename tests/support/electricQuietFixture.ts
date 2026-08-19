import type {EngineSnapshot} from "../../src/protocol.js";

export const fixtureContacts = {
  alice: "+12025550101",
  mateo: "+12025550102",
  casey: "+12025550103"
} as const;

/** Rich, deterministic, and intentionally synthetic visual-review state. */
export function electricQuietFixture(): EngineSnapshot {
  return {
    connection: {
      state: "connected",
      phone_name: "Nearby iPhone",
      message_type: "SMS_GSM"
    },
    contacts: [
      {alias: "alice", number: fixtureContacts.alice},
      {alias: "mateo", number: fixtureContacts.mateo},
      {alias: "casey", number: fixtureContacts.casey}
    ],
    session: {
      active_thread: fixtureContacts.alice,
      total_messages: 7,
      threads: [
        {
          participant: fixtureContacts.alice,
          unread: 0,
          draft: "",
          messages: [
            {
              id: 1,
              participant: fixtureContacts.alice,
              body: "Are you still coming?",
              direction: "incoming",
              state: "received",
              unread: false
            },
            {
              id: 2,
              participant: fixtureContacts.alice,
              body: "Perfect. Door is unlocked.",
              direction: "incoming",
              state: "received",
              unread: false
            },
            {
              id: 3,
              participant: fixtureContacts.alice,
              body: "Yep — leaving in five.",
              direction: "outgoing",
              state: "sent",
              unread: false
            },
            {
              id: 4,
              participant: fixtureContacts.alice,
              body: "I’ll bring the adapter.",
              direction: "outgoing",
              state: "sending",
              unread: false
            },
            {
              id: 5,
              participant: fixtureContacts.alice,
              body: "If that changed, check the phone.",
              direction: "outgoing",
              state: "unknown",
              unread: false
            }
          ]
        },
        {
          participant: fixtureContacts.mateo,
          unread: 2,
          draft: "Ask about dessert",
          messages: [
            {
              id: 6,
              participant: fixtureContacts.mateo,
              body: "Dinner moved to eight.",
              direction: "incoming",
              state: "received",
              unread: true
            }
          ]
        },
        {
          participant: fixtureContacts.casey,
          unread: 0,
          draft: "",
          messages: [
            {
              id: 7,
              participant: fixtureContacts.casey,
              body: "The fixture link is https://example.com/notes.",
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
