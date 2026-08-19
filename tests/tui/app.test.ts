import {expect, test} from "bun:test";
import {
  type BaseRenderable,
  type BoxRenderable,
  CliRenderEvents,
  type ScrollBoxRenderable,
  type TextareaRenderable,
  TextRenderable
} from "@opentui/core";
import {createTestRenderer, setRendererCapabilities} from "@opentui/core/testing";
import type {EngineSnapshot} from "../../src/protocol.js";
import {createBlupostTui} from "../../src/tui/index.js";
import {
  fixtureContacts,
  minimalMessagingFixture
} from "../support/minimalMessagingFixture.js";
import {RecordingEngineClient} from "../support/recordingEngineClient.js";

function snapshot(activeThread: string | null = null): EngineSnapshot {
  return {
    connection: {
      state: "connected",
      phone_name: "Test iPhone",
      message_type: "SMS_GSM"
    },
    contacts: [{alias: "alice", number: "+13125550123"}],
    session: {
      active_thread: activeThread,
      total_messages: activeThread ? 1 : 0,
      threads: activeThread
        ? [
            {
              participant: activeThread,
              unread: 0,
              draft: "",
              messages: [
                {
                  id: 1,
                  participant: activeThread,
                  body: "Terminal texting is alive.",
                  direction: "incoming",
                  state: "received",
                  unread: false
                }
              ]
            }
          ]
        : []
    }
  };
}

async function setupApp(
  initial = snapshot(),
  copyText?: (text: string) => Promise<"copied" | "terminal-attempted">,
  viewport: {width: number; height: number} = {width: 96, height: 24}
) {
  const setup = await createTestRenderer(viewport);
  const engine = new RecordingEngineClient(initial);
  const app = createBlupostTui({
    renderer: setup.renderer,
    engine,
    autoConnect: false,
    copyText
  });
  await app.start();
  await setup.renderOnce();
  return {setup, engine, app};
}

function findText(
  renderable: BaseRenderable,
  predicate: (text: TextRenderable) => boolean
): TextRenderable | undefined {
  if (renderable instanceof TextRenderable && predicate(renderable)) return renderable;
  for (const child of renderable.getChildren()) {
    const match = findText(child, predicate);
    if (match) return match;
  }
  return undefined;
}

test("renders only unique idle state at roomy widths", async () => {
  const {setup, app} = await setupApp();
  try {
    const frame = setup.captureCharFrame();
    expect(frame).toContain("alice");
    expect(frame).toContain("+ contact");
    expect(frame).toContain("connected");
    expect(frame.toLocaleLowerCase()).not.toContain("blupost");
    expect(frame).not.toContain("MESSAGES");
    expect(frame).not.toContain("SESSION");
    expect(frame).not.toContain("Ctrl+P");
    expect(frame).not.toContain("TO ");
  } finally {
    await app.stop();
  }
});

test("empty-contact guidance keeps one visible local action", async () => {
  const initial = snapshot();
  initial.contacts = [];
  const {setup, app} = await setupApp(initial);
  try {
    const frame = setup.captureCharFrame();
    expect(frame).toContain("No contacts.");
    expect(frame).toContain("+ contact");
    expect(frame).not.toContain("Select a contact.");
    expect(frame).not.toContain("contacts add");
    expect(frame).not.toContain("~/.config");
  } finally {
    await app.stop();
  }
});

test("a new conversation needs no recipient or session explanation", async () => {
  const active = "+13125550123";
  const initial = snapshot(active);
  initial.session.total_messages = 0;
  initial.session.threads[0]!.messages = [];
  const {setup, app} = await setupApp(initial);
  try {
    const frame = setup.captureCharFrame();
    expect(frame).toContain("No messages yet.");
    expect(frame).toContain("Write a message");
    expect(frame.match(/alice/gu)).toHaveLength(1);
    expect(frame.toLocaleLowerCase()).not.toContain("blupost");
    expect(frame).not.toContain("TO ");
  } finally {
    await app.stop();
  }
});

test("adds a contact from the sidebar form", async () => {
  const initial = snapshot();
  initial.contacts = [];
  const {setup, engine, app} = await setupApp(initial);
  let releaseAddContact: (() => void) | undefined;
  engine.addContactBarrier = new Promise(resolveAddContact => {
    releaseAddContact = resolveAddContact;
  });
  try {
    const addButton = setup.renderer.root.findDescendantById("add-contact-button");
    expect(addButton).toBeDefined();
    await setup.mockMouse.click(addButton!.screenX + 2, addButton!.screenY);
    await setup.renderOnce();
    const form = setup.captureCharFrame();
    expect(form).toContain("New contact");
    expect(form).toContain("Alias");
    expect(form).toContain("Phone number");
    expect(form).toContain("save");
    expect(form).toContain("cancel");
    expect(form).toContain("Stored locally.");

    await setup.mockInput.typeText("fixture_friend");
    setup.mockInput.pressEnter();
    await setup.mockInput.typeText("+12025550101");
    setup.mockInput.pressEnter();
    await new Promise<void>(resolveWait => setTimeout(resolveWait, 5));

    expect(engine.addedContacts).toEqual([
      {alias: "fixture_friend", number: "+12025550101"}
    ]);
    engine.emitSnapshot({
      ...initial,
      contacts: [{alias: "fixture_friend", number: "+12025550101"}]
    });
    releaseAddContact?.();
    await new Promise<void>(resolveWait => setTimeout(resolveWait, 5));
    await setup.renderOnce();

    const savedFrame = setup.captureCharFrame();
    expect(savedFrame).toContain("fixture_friend");
    expect(savedFrame).toContain("Saved locally.");
    expect(engine.selectedThreads).toEqual(["+12025550101"]);
  } finally {
    releaseAddContact?.();
    await app.stop();
  }
});

test("keeps contact fields visible when the engine rejects the save", async () => {
  const initial = snapshot();
  initial.contacts = [];
  const {setup, engine, app} = await setupApp(initial);
  engine.addContactError = new Error("fixture contact rejection");
  try {
    const addButton = setup.renderer.root.findDescendantById("add-contact-button");
    await setup.mockMouse.click(addButton!.screenX + 2, addButton!.screenY);
    await setup.mockInput.typeText("fixture_friend");
    setup.mockInput.pressEnter();
    await setup.mockInput.typeText("+12025550101");
    setup.mockInput.pressEnter();
    await new Promise<void>(resolveWait => setTimeout(resolveWait, 5));
    await setup.renderOnce();

    const frame = setup.captureCharFrame();
    const error = setup.renderer.root.findDescendantById(
      "contact-error"
    ) as TextRenderable;
    expect(frame).toContain("fixture_friend");
    expect(frame).toContain("+12025550101");
    expect(error.plainText).toBe("fixture contact rejection");
  } finally {
    await app.stop();
  }
});

test("opens and cancels the contact form from the keyboard", async () => {
  const {setup, engine, app} = await setupApp();
  try {
    setup.mockInput.pressEscape();
    await new Promise<void>(resolveWait => setTimeout(resolveWait, 25));
    setup.mockInput.pressKey("a");
    await setup.renderOnce();
    const view = setup.renderer.root.findDescendantById("contact-view");
    expect(view?.visible).toBe(true);

    setup.mockInput.pressEscape();
    await new Promise<void>(resolveWait => setTimeout(resolveWait, 25));
    await setup.renderOnce();
    expect(view?.visible).toBe(false);
    expect(engine.addedContacts).toEqual([]);
  } finally {
    await app.stop();
  }
});

test("submits the composer through the engine seam", async () => {
  const active = "+13125550123";
  const {setup, engine, app} = await setupApp(snapshot(active));
  try {
    await setup.mockInput.typeText("hello from OpenTUI");
    setup.mockInput.pressEnter();
    await new Promise<void>(resolveWait => setTimeout(resolveWait, 5));
    expect(engine.sends).toEqual([{recipient: active, body: "hello from OpenTUI"}]);
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Terminal texting is alive.");
  } finally {
    await app.stop();
  }
});

test("renders message URLs as terminal hyperlinks", async () => {
  const active = "+13125550123";
  const initial = snapshot(active);
  const url = "https://example.com/docs";
  initial.session.threads[0]!.messages[0]!.body = `Open (${url}).`;
  const {setup, app} = await setupApp(initial);
  try {
    const message = findText(setup.renderer.root, text =>
      text.chunks.some(chunk => chunk.link?.url === url)
    );
    expect(message).toBeDefined();
    expect(message!.chunks.some(chunk => chunk.link?.url === url)).toBe(true);
    expect(
      message!.chunks.some(chunk => chunk.link !== undefined && chunk.link.url !== url)
    ).toBe(false);
    expect(message!.plainText).toContain(`Open (${url}).`);
  } finally {
    await app.stop();
  }
});

test("copies a mouse selection from a rendered message", async () => {
  const active = "+13125550123";
  const selected = "copy this text";
  const initial = snapshot(active);
  initial.session.threads[0]!.messages[0]!.body = selected;
  const copied: string[] = [];
  const {setup, app} = await setupApp(initial, async text => {
    copied.push(text);
    return "copied";
  });
  try {
    const message = findText(setup.renderer.root, text =>
      text.plainText.includes(selected)
    );
    expect(message).toBeDefined();
    const start = message!.plainText.indexOf(selected);
    setup.renderer.startSelection(message!, message!.x + start, message!.y);
    setup.renderer.updateSelection(
      message!,
      message!.x + start + selected.length,
      message!.y,
      {finishDragging: true}
    );
    const selection = setup.renderer.getSelection();
    expect(selection?.getSelectedText()).toBe(selected);
    expect(selection).not.toBeNull();
    setup.renderer.emit(CliRenderEvents.SELECTION, selection!);
    await new Promise<void>(resolveWait => setTimeout(resolveWait, 5));

    expect(copied).toEqual([selected]);
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Selection copied.");
  } finally {
    await app.stop();
  }
});

test("restores the composer when the engine rejects before accepting a send", async () => {
  const active = "+13125550123";
  const {setup, engine, app} = await setupApp(snapshot(active));
  engine.sendError = new Error("fixture rejection");
  try {
    await setup.mockInput.typeText("please keep this draft");
    setup.mockInput.pressEnter();
    await new Promise<void>(resolveWait => setTimeout(resolveWait, 5));
    await setup.renderOnce();

    expect(engine.sends).toEqual([{recipient: active, body: "please keep this draft"}]);
    expect(engine.draftUpdates.at(-1)).toEqual({
      recipient: active,
      body: "please keep this draft"
    });
    expect(setup.captureCharFrame()).toContain("please keep this draft");
  } finally {
    await app.stop();
  }
});

test("keeps newer typing when restoring a send rejected before acceptance", async () => {
  const active = "+13125550123";
  const {setup, engine, app} = await setupApp(snapshot(active));
  let releaseSend: (() => void) | undefined;
  engine.sendBarrier = new Promise(resolveSend => {
    releaseSend = resolveSend;
  });
  engine.sendError = new Error("fixture rejection");
  try {
    await setup.mockInput.typeText("original draft");
    setup.mockInput.pressEnter();
    await new Promise<void>(resolveWait => setTimeout(resolveWait, 5));
    await setup.mockInput.typeText("newer draft");
    releaseSend?.();
    await new Promise<void>(resolveWait => setTimeout(resolveWait, 5));
    await setup.renderOnce();

    expect(engine.draftUpdates.at(-1)).toEqual({
      recipient: active,
      body: "original draft\nnewer draft"
    });
    const frame = setup.captureCharFrame();
    expect(frame).toContain("original draft");
    expect(frame).toContain("newer draft");
  } finally {
    releaseSend?.();
    await app.stop();
  }
});

test("clicking a thread selects it through the engine seam", async () => {
  const {setup, engine, app} = await setupApp();
  try {
    const row = setup.renderer.root.findDescendantById("thread-row-0");
    expect(row).toBeDefined();
    await setup.mockMouse.click(row!.screenX + 2, row!.screenY);
    await new Promise<void>(resolveWait => setTimeout(resolveWait, 5));
    expect(engine.selectedThreads).toEqual(["+13125550123"]);
  } finally {
    await app.stop();
  }
});

test("clicking SEND submits the current composer", async () => {
  const active = "+13125550123";
  const {setup, engine, app} = await setupApp(snapshot(active));
  try {
    await setup.mockInput.typeText("clicked send");
    await setup.renderOnce();
    const sendButton = setup.renderer.root.findDescendantById("send-button");
    expect(sendButton).toBeDefined();
    await setup.mockMouse.click(sendButton!.screenX + 2, sendButton!.screenY);
    await new Promise<void>(resolveWait => setTimeout(resolveWait, 5));
    expect(engine.sends).toEqual([{recipient: active, body: "clicked send"}]);
  } finally {
    await app.stop();
  }
});

test("the visible send action cannot send an empty composer", async () => {
  const active = "+13125550123";
  const {setup, engine, app} = await setupApp(snapshot(active));
  try {
    const sendButton = setup.renderer.root.findDescendantById("send-button");
    expect(sendButton?.visible).toBe(true);
    await setup.mockMouse.click(sendButton!.screenX + 1, sendButton!.screenY);
    await setup.renderOnce();
    expect(engine.sends).toEqual([]);
  } finally {
    await app.stop();
  }
});

test("startup requests exactly one initial connection", async () => {
  const setup = await createTestRenderer({width: 80, height: 24});
  const engine = new RecordingEngineClient(snapshot());
  const app = createBlupostTui({
    renderer: setup.renderer,
    engine,
    autoConnect: true
  });
  try {
    await app.start();
    expect(engine.connectCount).toBe(1);
  } finally {
    await app.stop();
  }
});

test("clicking disconnected status requests a reconnect", async () => {
  const disconnected = snapshot();
  disconnected.connection = {state: "disconnected"};
  const {setup, engine, app} = await setupApp(disconnected);
  try {
    const status = setup.renderer.root.findDescendantById("connection-status");
    expect(status).toBeDefined();
    await setup.mockMouse.click(status!.screenX + 1, status!.screenY);
    await new Promise<void>(resolveWait => setTimeout(resolveWait, 5));
    expect(engine.connectCount).toBe(1);
  } finally {
    await app.stop();
  }
});

test("keeps drafts scoped to their thread", async () => {
  const alice = "+13125550123";
  const bob = "+13125550124";
  const initial = snapshot(alice);
  initial.contacts.push({alias: "bob", number: bob});
  const {setup, engine, app} = await setupApp(initial);
  try {
    await setup.mockInput.typeText("alice draft");
    engine.emitSnapshot({
      ...initial,
      session: {
        ...initial.session,
        active_thread: bob,
        threads: [
          {...initial.session.threads[0]!, draft: "alice draft"},
          {participant: bob, unread: 0, draft: "", messages: []}
        ]
      }
    });
    await setup.mockInput.typeText("bob draft");
    engine.emitSnapshot({
      ...initial,
      session: {
        ...initial.session,
        active_thread: alice,
        threads: [
          {...initial.session.threads[0]!, draft: "alice draft"},
          {participant: bob, unread: 0, draft: "bob draft", messages: []}
        ]
      }
    });
    setup.mockInput.pressEnter();
    await new Promise<void>(resolveWait => setTimeout(resolveWait, 5));
    expect(engine.sends).toEqual([{recipient: alice, body: "alice draft"}]);
    expect(engine.draftUpdates).toContainEqual({recipient: bob, body: "bob draft"});
  } finally {
    await app.stop();
  }
});

test("clicking the transcript does not shift its layout", async () => {
  const setup = await createTestRenderer({width: 96, height: 24});
  const engine = new RecordingEngineClient(snapshot());
  const app = createBlupostTui({
    renderer: setup.renderer,
    engine,
    autoConnect: false
  });
  try {
    await app.start();
    await setup.renderOnce();
    await setup.mockMouse.click(4, 4);
    const transcript = setup.renderer.root.findDescendantById("transcript");
    expect(transcript).toBeDefined();
    expect(transcript!.translateX).toBe(0);
  } finally {
    await app.stop();
  }
});

test("roomy layout keeps only conversation state and the active task", async () => {
  const active = "+13125550123";
  const {setup, app} = await setupApp(snapshot(active), undefined, {
    width: 120,
    height: 34
  });
  try {
    const frame = setup.captureCharFrame();
    expect(frame).toContain("▌ alice");
    expect(frame).toContain("Terminal texting is alive.");
    expect(frame).toContain("Write a message");
    expect(frame).toContain("+ contact");
    expect(frame).toContain("connected");
    expect(frame.match(/alice/gu)).toHaveLength(1);
    expect(frame).not.toContain("MESSAGES");
    expect(frame).not.toContain("SESSION");
    expect(frame).not.toContain("TO ");
    expect(frame).not.toContain("Message alice");
    expect(frame).not.toContain("You");
  } finally {
    await app.stop();
  }
});

test("compact chat is one pane and Escape returns through the navigation stack", async () => {
  const active = "+13125550123";
  const {setup, engine, app} = await setupApp(snapshot(active), undefined, {
    width: 60,
    height: 18
  });
  try {
    await setup.mockInput.typeText("compact draft");
    await setup.renderOnce();
    const composerFrame = setup.captureCharFrame();
    expect(composerFrame).toContain("‹ alice");
    expect(composerFrame).toContain("compact draft");
    expect(composerFrame).not.toContain("+ contact");

    setup.mockInput.pressEscape();
    await new Promise<void>(resolveWait => setTimeout(resolveWait, 25));
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("‹ alice");

    setup.mockInput.pressEscape();
    await new Promise<void>(resolveWait => setTimeout(resolveWait, 25));
    await setup.renderOnce();
    const listFrame = setup.captureCharFrame();
    expect(listFrame).toContain("contacts");
    expect(listFrame).toContain("+ contact");
    expect(listFrame.match(/Terminal texting is alive\./gu)).toHaveLength(1);
    expect(setup.renderer.root.findDescendantById("conversation-detail")?.visible).toBe(
      false
    );
    expect(engine.draftUpdates).toContainEqual({
      recipient: active,
      body: "compact draft"
    });
  } finally {
    await app.stop();
  }
});

test("list movement stays local until Enter opens the selected conversation", async () => {
  const bob = "+13125550124";
  const initial = snapshot();
  initial.contacts.push({alias: "bob", number: bob});
  const {setup, engine, app} = await setupApp(initial, undefined, {
    width: 60,
    height: 18
  });
  try {
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    expect(engine.selectedThreads).toEqual([]);
    expect(setup.captureCharFrame()).toContain("› bob");

    setup.mockInput.pressEnter();
    expect(engine.selectedThreads).toEqual([bob]);
  } finally {
    await app.stop();
  }
});

test("contextual Help explains navigation and session limits", async () => {
  const {setup, app} = await setupApp(snapshot(), undefined, {
    width: 60,
    height: 18
  });
  try {
    setup.mockInput.pressKey("?");
    await setup.renderOnce();
    const help = setup.captureCharFrame();
    const completeHelp = findText(setup.renderer.root, text =>
      text.plainText.includes("Ctrl+C")
    );
    expect(help).toContain("Help");
    expect(help).toContain("select");
    expect(help).toContain("open");
    expect(help).toContain("Messages and drafts last only while Blupost is open.");
    expect(help).toContain("Offline sends are never queued or retried.");
    expect(completeHelp?.plainText).toContain("Ctrl+C");

    setup.mockInput.pressEscape();
    await new Promise<void>(resolveWait => setTimeout(resolveWait, 25));
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("contacts");
  } finally {
    await app.stop();
  }
});

test("tiny viewport keeps one usable pane with no overflow", async () => {
  const active = "+13125550123";
  const {setup, app} = await setupApp(snapshot(active), undefined, {
    width: 40,
    height: 12
  });
  try {
    const frame = setup.captureCharFrame();
    const lines = frame.split("\n").filter((_, index, all) => {
      return index < all.length - 1 || all[index] !== "";
    });
    expect(frame).toContain("‹ alice");
    expect(frame).toContain("alice");
    expect(frame).not.toContain("+ contact");
    expect(lines).toHaveLength(12);
    expect(lines.every(line => line.length <= 40)).toBe(true);
  } finally {
    await app.stop();
  }
});

test("tiny Add Contact keeps both fields and the primary action reachable", async () => {
  const initial = snapshot();
  initial.contacts = [];
  const {setup, app} = await setupApp(initial, undefined, {
    width: 40,
    height: 12
  });
  try {
    setup.mockInput.pressKey("a");
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("New contact");
    expect(frame).toContain("Alias");
    expect(frame).toContain("Phone number");
    expect(frame).toContain("save");
    expect(frame).toContain("cancel");
  } finally {
    await app.stop();
  }
});

test("resize preserves the active draft while switching to compact navigation", async () => {
  const active = "+13125550123";
  const {setup, app} = await setupApp(snapshot(active), undefined, {
    width: 90,
    height: 24
  });
  try {
    await setup.mockInput.typeText("survives resize");
    setup.resize(60, 18);
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("‹ alice");
    expect(frame).toContain("survives resize");
  } finally {
    await app.stop();
  }
});

test("message bodies and truthful outcomes render as separate selectable text", async () => {
  const active = "+13125550123";
  const initial = snapshot(active);
  initial.session.threads[0]!.messages.push({
    id: 2,
    participant: active,
    body: "Outcome stays separate",
    direction: "outgoing",
    state: "unknown",
    unread: false
  });
  const {setup, app} = await setupApp(initial);
  try {
    const body = findText(
      setup.renderer.root,
      text => text.plainText === "Outcome stays separate"
    );
    const outcome = findText(setup.renderer.root, text =>
      text.plainText.startsWith("Check your phone")
    );
    expect(body).toBeDefined();
    expect(outcome?.plainText).toBe("Check your phone — outcome unknown");
  } finally {
    await app.stop();
  }
});

test("new incoming messages do not yank a transcript being read", async () => {
  const active = "+13125550123";
  const initial = snapshot(active);
  initial.session.threads[0]!.messages = Array.from({length: 18}, (_, index) => ({
    id: index + 1,
    participant: active,
    body: `Earlier message ${index + 1}`,
    direction: "incoming" as const,
    state: "received" as const,
    unread: false
  }));
  initial.session.total_messages = 18;
  const {setup, engine, app} = await setupApp(initial, undefined, {
    width: 60,
    height: 18
  });
  try {
    setup.mockInput.pressEscape();
    await new Promise<void>(resolveWait => setTimeout(resolveWait, 25));
    const transcript = setup.renderer.root.findDescendantById(
      "transcript"
    ) as ScrollBoxRenderable;
    transcript.scrollBy(-1, "viewport");
    await setup.renderOnce();
    const priorScrollTop = transcript.scrollTop;

    const updated = structuredClone(initial);
    updated.session.total_messages = 19;
    updated.session.threads[0]!.messages.push({
      id: 19,
      participant: active,
      body: "New while reading",
      direction: "incoming",
      state: "received",
      unread: true
    });
    engine.emitSnapshot(updated);
    await setup.renderOnce();

    expect(setup.captureCharFrame()).toContain("↓ 1 new");
    expect(transcript.scrollTop).toBeLessThanOrEqual(priorScrollTop);

    setup.mockInput.pressKey("END");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).not.toContain("↓ 1 new");
  } finally {
    await app.stop();
  }
});

test("disconnected composer preserves edits and explains that nothing queues", async () => {
  const active = "+13125550123";
  const initial = snapshot(active);
  initial.connection = {state: "disconnected"};
  const {setup, engine, app} = await setupApp(initial);
  try {
    await setup.mockInput.typeText("keep offline");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    const composer = setup.renderer.root.findDescendantById(
      "composer"
    ) as TextareaRenderable;
    expect(engine.sends).toEqual([]);
    expect(composer.plainText).toBe("keep offline");
    expect(setup.captureCharFrame()).toContain(
      "Offline — draft only; nothing will queue."
    );
  } finally {
    await app.stop();
  }
});

test.each([
  [120, 34],
  [80, 24],
  [60, 18],
  [40, 12]
] as const)("%ix%i keeps one identity, one connection state, and a bounded frame", async (width, height) => {
  const {setup, app} = await setupApp(minimalMessagingFixture(), undefined, {
    width,
    height
  });
  try {
    const frame = setup.captureCharFrame();
    const lines = frame.split("\n").slice(0, height);

    expect(frame.match(/alice/gu)).toHaveLength(1);
    expect(frame.match(/connected/gu)).toHaveLength(1);
    expect(frame.toLocaleLowerCase()).not.toContain("blupost");
    expect(frame).not.toContain("TO ");
    expect(frame).not.toContain("Message alice");
    expect(frame).not.toContain("SESSION");
    expect(frame).not.toContain("MESSAGES");
    expect(frame).not.toContain("You");
    expect(frame).toContain("Write a message");
    expect(lines).toHaveLength(height);
    expect(lines.every(line => line.length <= width)).toBe(true);
  } finally {
    await app.stop();
  }
});

test("Ctrl+P preserves a composer draft through filtering, help, and Escape", async () => {
  const {setup, app} = await setupApp(minimalMessagingFixture());
  try {
    await setup.mockInput.typeText("palette draft");
    setup.mockInput.pressKey("p", {ctrl: true});
    await setup.flush();

    const composer = setup.renderer.root.findDescendantById(
      "composer"
    ) as TextareaRenderable;
    expect(setup.captureCharFrame()).toContain("Search");
    expect(composer.plainText).toBe("palette draft");

    setup.mockInput.pressEscape();
    await new Promise<void>(resolveWait => setTimeout(resolveWait, 25));
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("palette draft");
    expect(composer.plainText).toBe("palette draft");

    setup.mockInput.pressKey("p", {ctrl: true});
    await setup.mockInput.typeText("help");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Open help");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Help");

    setup.mockInput.pressEscape();
    await new Promise<void>(resolveWait => setTimeout(resolveWait, 25));
    await setup.renderOnce();
    expect(composer.plainText).toBe("palette draft");
  } finally {
    await app.stop();
  }
});

test("the command palette activates add, reconnect, help, and conversation entries", async () => {
  const initial = minimalMessagingFixture();
  const {setup, engine, app} = await setupApp(initial);
  try {
    setup.mockInput.pressKey("p", {ctrl: true});
    await setup.flush();
    const addRow = setup.renderer.root.findDescendantById("palette-row-0-label");
    expect(addRow).toBeDefined();
    await setup.mockMouse.click(addRow!.screenX + 2, addRow!.screenY);
    await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("contact-view")?.visible).toBe(true);
    setup.mockInput.pressEscape();
    await new Promise<void>(resolveWait => setTimeout(resolveWait, 25));
    await setup.renderOnce();

    const disconnected = structuredClone(initial);
    disconnected.connection = {state: "disconnected"};
    engine.emitSnapshot(disconnected);
    setup.mockInput.pressKey("p", {ctrl: true});
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("› Reconnect");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("command-palette-search");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await Promise.resolve();
    expect(engine.connectCount).toBe(1);

    setup.mockInput.pressKey("p", {ctrl: true});
    await setup.mockInput.typeText("help");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Help");
    setup.mockInput.pressEscape();
    await new Promise<void>(resolveWait => setTimeout(resolveWait, 25));

    setup.mockInput.pressKey("p", {ctrl: true});
    await setup.mockInput.typeText("mateo");
    await setup.flush();
    const conversationRow =
      setup.renderer.root.findDescendantById("palette-row-0-label");
    expect(conversationRow).toBeDefined();
    await setup.mockMouse.click(conversationRow!.screenX + 2, conversationRow!.screenY);
    await Promise.resolve();
    expect(engine.selectedThreads).toContain(fixtureContacts.mateo);
  } finally {
    await app.stop();
  }
});

test("the command palette remains usable at 40x12", async () => {
  const {setup, app} = await setupApp(minimalMessagingFixture(), undefined, {
    width: 40,
    height: 12
  });
  try {
    setup.mockInput.pressKey("p", {ctrl: true});
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    const lines = frame.split("\n").slice(0, 12);
    expect(frame).toContain("Actions");
    expect(frame).toContain("Search");
    expect(frame).toContain("Add contact");
    expect(lines).toHaveLength(12);
    expect(lines.every(line => line.length <= 40)).toBe(true);
  } finally {
    await app.stop();
  }
});

test("approved layout preserves focus, subtle surfaces, and message direction", async () => {
  const {setup, app} = await setupApp(minimalMessagingFixture(), undefined, {
    width: 120,
    height: 34
  });
  try {
    const composer = setup.renderer.root.findDescendantById(
      "composer-region"
    ) as BoxRenderable;
    expect(composer.borderStyle).toBe("single");
    expect(
      (setup.renderer.root.findDescendantById("composer-prompt") as TextRenderable)
        .plainText
    ).toBe("");
    const initialFrame = setup.captureCharFrame();
    expect(initialFrame).toContain("▌ alice");
    expect(initialFrame).not.toContain("You");
    expect(initialFrame).not.toContain("TO ");
    expect(initialFrame).not.toContain("Message alice");
    expect(initialFrame).not.toContain("SESSION");

    const incoming = setup.renderer.root.findDescendantById(
      "message-body-1"
    ) as TextRenderable;
    const outgoing = setup.renderer.root.findDescendantById(
      "message-body-3"
    ) as TextRenderable;
    expect(outgoing.screenX).toBeGreaterThan(incoming.screenX);
    expect(setup.renderer.root.findDescendantById("message-surface-1")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("message-surface-3")).toBeDefined();

    setup.mockInput.pressTab();
    await setup.renderOnce();
    const composerUnfocused = setup.renderer.root.findDescendantById(
      "composer-region"
    ) as BoxRenderable;
    expect(composerUnfocused.borderStyle).toBe("single");
    expect(
      (setup.renderer.root.findDescendantById("composer-prompt") as TextRenderable)
        .plainText
    ).toBe("");
    expect(setup.captureCharFrame()).toContain("› alice");
  } finally {
    await app.stop();
  }
});

test("uses the real mark with image-capable terminals and a clean text fallback", async () => {
  const setup = await createTestRenderer({width: 120, height: 34});
  setRendererCapabilities(setup.renderer, {
    kitty_graphics: true,
    image_protocol: "kitty",
    terminal: {name: "kitty"}
  });
  const engine = new RecordingEngineClient(snapshot("+13125550123"));
  const app = createBlupostTui({
    renderer: setup.renderer,
    engine,
    autoConnect: false
  });
  try {
    await app.start();
    await setup.renderOnce();
    const brand = setup.renderer.root.findDescendantById("brand-mark");
    const brandRow = setup.renderer.root.findDescendantById(
      "sidebar-brand-row"
    ) as BoxRenderable;
    const firstConversation = setup.renderer.root.findDescendantById("thread-row-0");
    const connection = setup.renderer.root.findDescendantById("connection-status");
    expect(brand?.visible).toBe(true);
    expect(setup.renderer.root.findDescendantById("brand-mark-fallback")?.visible).toBe(
      false
    );
    expect(firstConversation!.screenY - brand!.screenY).toBeGreaterThanOrEqual(3);
    expect(connection!.screenY).toBe(brandRow.screenY + brandRow.height - 2);
    expect(connection!.screenX).toBeGreaterThan(brand!.screenX);
    expect(
      setup.captureCharFrame().split("\n")[brandRow.screenY + brandRow.height - 1]
    ).toContain("─");

    setRendererCapabilities(setup.renderer, {image_protocol: "blocks"});
    setup.renderer.emit(CliRenderEvents.CAPABILITIES, setup.renderer.capabilities);
    await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("brand-mark")?.visible).toBe(false);
    expect(setup.renderer.root.findDescendantById("brand-mark-fallback")?.visible).toBe(
      true
    );
    expect(setup.captureCharFrame()).toContain("b");
  } finally {
    await app.stop();
  }
});

test("send state replaces in place without animation or duplicate status copy", async () => {
  const {setup, engine, app} = await setupApp(snapshot("+13125550123"), undefined, {
    width: 80,
    height: 24
  });
  try {
    const sending = snapshot("+13125550123");
    sending.session.total_messages = 2;
    sending.session.threads[0]!.messages.push({
      id: 2,
      participant: "+13125550123",
      body: "Fixture outgoing",
      direction: "outgoing",
      state: "sending",
      unread: false
    });
    engine.emitSnapshot(sending);
    await setup.renderOnce();
    expect(setup.captureCharFrame().match(/sending…/gu)).toHaveLength(1);

    const sent = structuredClone(sending);
    sent.session.threads[0]!.messages.at(-1)!.state = "sent";
    engine.emitSnapshot(sent);
    await setup.renderOnce();
    const outcome = setup.renderer.root.findDescendantById(
      "message-outcome-2"
    ) as TextRenderable;
    expect(outcome.plainText).toBe("✓");
    expect(setup.captureCharFrame()).not.toContain("sending…");
  } finally {
    await app.stop();
  }
});

test("renderer destruction closes the engine and resolves the app once", async () => {
  const setup = await createTestRenderer({width: 80, height: 24});
  const engine = new RecordingEngineClient(snapshot());
  const app = createBlupostTui({
    renderer: setup.renderer,
    engine,
    autoConnect: false
  });
  await app.start();
  let releaseStop: (() => void) | undefined;
  engine.stopBarrier = new Promise(resolveStop => {
    releaseStop = resolveStop;
  });

  setup.renderer.destroy();
  let waitResolved = false;
  const waiting = app.waitUntilExit().then(() => {
    waitResolved = true;
  });
  const repeatedStop = app.stop();
  await Promise.resolve();

  expect(engine.stopCount).toBe(1);
  expect(waitResolved).toBe(false);

  releaseStop?.();
  await Promise.all([waiting, repeatedStop]);
  expect(waitResolved).toBe(true);
});
