import {
  BoxRenderable,
  bg,
  bold,
  CliRenderEvents,
  type CliRenderer,
  fg,
  ImageRenderable,
  type KeyEvent,
  link,
  ScrollBoxRenderable,
  type Selection,
  StyledText,
  TextareaRenderable,
  type TextChunk,
  TextRenderable,
  underline
} from "@opentui/core";
import type {EngineClient} from "../engine/createEngineClient.js";
import {
  type EngineEvent,
  emptySnapshot,
  type MessageState,
  type SessionMessage
} from "../protocol.js";
import {blupostMarkPng} from "./brandAsset.js";
import {type BlupostLayout, computeBlupostLayout} from "./layout.js";
import {MotionController, mixHexColors} from "./motion.js";
import {
  type BlupostPresentation,
  createBlupostPresentation,
  type MessagePresentation,
  type PresentationTone
} from "./presentation.js";
import {blupostTheme} from "./theme.js";
import {
  type ActionRibbon,
  createBlupostChrome,
  type VisualContext
} from "./visualLanguage.js";

type FocusContext = VisualContext;
type RestorableFocus = Exclude<FocusContext, "contact" | "help" | "palette">;
type CompactPane = "list" | "chat";
type ContactControl = "alias" | "number" | "save" | "cancel";
type PaletteEntry =
  | {kind: "thread"; label: string; description: string; number: string}
  | {kind: "add" | "reconnect" | "help"; label: string; description: string};

interface ViewRefs {
  root: BoxRenderable;
  header: BoxRenderable;
  brand: ImageRenderable;
  connection: TextRenderable;
  main: BoxRenderable;
  sidebar: BoxRenderable;
  listHeader: TextRenderable;
  threadList: ScrollBoxRenderable;
  addContactButton: TextRenderable;
  contactForm: BoxRenderable;
  contactAlias: TextareaRenderable;
  contactNumberLabel: TextRenderable;
  contactNumber: TextareaRenderable;
  contactDisclosure: TextRenderable;
  contactError: TextRenderable;
  saveContactButton: TextRenderable;
  cancelContactButton: TextRenderable;
  chat: BoxRenderable;
  chatHeader: BoxRenderable;
  backButton: TextRenderable;
  conversationTitle: TextRenderable;
  sessionLabel: TextRenderable;
  transcript: ScrollBoxRenderable;
  newMessageNotice: TextRenderable;
  composerBox: BoxRenderable;
  composerLabel: TextRenderable;
  composerRow: BoxRenderable;
  composer: TextareaRenderable;
  sendButton: TextRenderable;
  composerNote: TextRenderable;
  helpPanel: ScrollBoxRenderable;
  paletteOverlay: BoxRenderable;
  palettePanel: BoxRenderable;
  paletteSearch: TextareaRenderable;
  paletteResults: ScrollBoxRenderable;
  footer: BoxRenderable;
  modeBadge: TextRenderable;
  status: TextRenderable;
  sessionCount: TextRenderable;
  helpButton: TextRenderable;
}

export interface BlupostTuiOptions {
  renderer: CliRenderer;
  engine: EngineClient;
  interactive?: boolean | undefined;
  autoConnect?: boolean | undefined;
  copyText?: ((text: string) => Promise<"copied" | "terminal-attempted">) | undefined;
  /** Optional deterministic driver for focused motion integration tests. */
  motionController?: MotionController | undefined;
}

export interface BlupostTui {
  start(): Promise<void>;
  waitUntilExit(): Promise<void>;
  stop(error?: Error): Promise<void>;
}

function clearChildren(container: BoxRenderable | ScrollBoxRenderable): void {
  for (const child of [...container.getChildren()]) child.destroyRecursively();
}

function snapshotMessages(
  snapshot: ReturnType<typeof emptySnapshot>
): SessionMessage[] {
  return snapshot.session.threads.flatMap(thread => thread.messages);
}

function toneColor(tone: PresentationTone): string {
  return blupostTheme[tone];
}

function keyRibbonContent(actions: readonly ActionRibbon[]): StyledText {
  const chunks: TextChunk[] = [];
  for (const [index, action] of actions.entries()) {
    if (index > 0) chunks.push({__isChunk: true, text: "  "});
    chunks.push(
      bg(blupostTheme.selectionIdle)(fg(blupostTheme.textPrimary)(` ${action.key} `))
    );
    chunks.push(fg(blupostTheme.textSecondary)(` ${action.label}`));
  }
  return new StyledText(chunks);
}

const messageUrl = /\bhttps?:\/\/[^\s<>"'`]+/giu;

function splitTrailingUrlPunctuation(candidate: string): {
  url: string;
  trailing: string;
} {
  let url = candidate;
  let trailing = "";
  while (/[.,!?;:]$/u.test(url)) {
    trailing = `${url.at(-1)}${trailing}`;
    url = url.slice(0, -1);
  }
  for (const [open, close] of [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"]
  ] as const) {
    while (url.endsWith(close) && url.split(close).length > url.split(open).length) {
      trailing = `${close}${trailing}`;
      url = url.slice(0, -1);
    }
  }
  return {url, trailing};
}

function linkifyMessage(content: string): StyledText {
  const chunks: TextChunk[] = [];
  let cursor = 0;
  for (const match of content.matchAll(messageUrl)) {
    const index = match.index;
    if (index > cursor) {
      chunks.push({__isChunk: true, text: content.slice(cursor, index)});
    }
    const candidate = match[0];
    const {url, trailing} = splitTrailingUrlPunctuation(candidate);
    if (url) chunks.push(underline(fg(blupostTheme.blue)(link(url)(url))));
    if (trailing) chunks.push({__isChunk: true, text: trailing});
    cursor = index + candidate.length;
  }
  if (cursor < content.length) {
    chunks.push({__isChunk: true, text: content.slice(cursor)});
  }
  if (chunks.length === 0) chunks.push({__isChunk: true, text: content});
  return new StyledText(chunks);
}

class BlupostTuiApp implements BlupostTui {
  private snapshot = emptySnapshot();
  private presentation: BlupostPresentation;
  private layout: BlupostLayout;
  private refs: ViewRefs;
  private readonly motion: MotionController;
  private unsubscribe: (() => void) | undefined;
  private resolveExit: (() => void) | undefined;
  private readonly exitPromise: Promise<void>;
  private exitError: Error | undefined;
  private stopTask: Promise<void> | undefined;
  private stopped = false;
  private spinner = "◌";
  private sendingSpinner = "◌";
  private sendingMotionActive = false;
  private readonly messageSurfaces = new Map<number, BoxRenderable>();
  private readonly messageOutcomes = new Map<number, TextRenderable>();
  private readonly threadRows = new Map<string, BoxRenderable>();
  private readonly threadRowBaseColors = new Map<string, string>();
  private readonly incomingSettle = new Map<number, number>();
  private readonly incomingThreadSettle = new Map<string, number>();
  private readonly sentSettle = new Map<number, number>();
  private lastMessageId = 0;
  private ignoredComposerValue: string | undefined;
  private sendInFlight = false;
  private contactFormOpen = false;
  private contactSaveInFlight = false;
  private contactError = "";
  private composerError = "";
  private noticeMessage = "";
  private noticeTone: PresentationTone = "muted";
  private focusContext: FocusContext = "list";
  private helpReturnFocus: RestorableFocus = "list";
  private paletteReturnFocus: RestorableFocus = "list";
  private contactReturnFocus: RestorableFocus = "list";
  private compactPane: CompactPane = "list";
  private selectedThread: string | null = null;
  private pendingOpenThread: string | null = null;
  private contactControl: ContactControl = "alias";
  private paletteSelection = 0;
  private ignoredPaletteValue: string | undefined;
  private hasReceivedSnapshot = false;
  private newMessageCount = 0;
  private newMessageThread: string | null = null;

  constructor(private readonly options: BlupostTuiOptions) {
    this.exitPromise = new Promise(resolveExit => {
      this.resolveExit = resolveExit;
    });
    this.layout = computeBlupostLayout(
      options.renderer.terminalWidth,
      options.renderer.terminalHeight
    );
    this.presentation = createBlupostPresentation(
      this.snapshot,
      this.spinner,
      this.sendingSpinner
    );
    this.motion =
      options.motionController ??
      new MotionController({
        animated: options.interactive ?? true,
        requestFrame: () => options.renderer.requestRender()
      });
    this.refs = this.buildView();
    options.renderer.root.add(this.refs.root);
    options.renderer.keyInput.on("keypress", this.handleKeyPress);
    options.renderer.on(CliRenderEvents.RESIZE, this.handleResize);
    options.renderer.on(CliRenderEvents.DESTROY, this.handleRendererDestroy);
    options.renderer.on(CliRenderEvents.SELECTION, this.handleSelection);
    this.unsubscribe = options.engine.subscribe(this.handleEngineEvent);
    this.applyLayout();
    this.render();
    this.startBrandReveal();
  }

  async start(): Promise<void> {
    try {
      await this.options.engine.start();
      if (this.stopped) return;
      if (this.options.autoConnect !== false) await this.reconnect();
    } catch (error) {
      if (!this.stopped) this.reportError(error);
    }
    if (this.stopped || this.contactFormOpen) return;
    const initialFocus: RestorableFocus = this.snapshot.session.active_thread
      ? "composer"
      : "list";
    if (!this.layout.showSidebar && initialFocus !== "list") this.compactPane = "chat";
    this.setFocus(initialFocus);
  }

  async waitUntilExit(): Promise<void> {
    await this.exitPromise;
    if (this.exitError) throw this.exitError;
  }

  stop(error?: Error): Promise<void> {
    if (error && !this.exitError) this.exitError = error;
    this.stopTask ??= this.performStop();
    return this.stopTask;
  }

  private async performStop(): Promise<void> {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.motion.dispose();
    this.options.renderer.keyInput.off("keypress", this.handleKeyPress);
    this.options.renderer.off(CliRenderEvents.RESIZE, this.handleResize);
    this.options.renderer.off(CliRenderEvents.DESTROY, this.handleRendererDestroy);
    this.options.renderer.off(CliRenderEvents.SELECTION, this.handleSelection);
    try {
      await this.options.engine.stop();
    } catch (error) {
      this.exitError ??= error instanceof Error ? error : new Error(String(error));
    } finally {
      try {
        this.options.renderer.destroy();
      } catch (error) {
        this.exitError ??= error instanceof Error ? error : new Error(String(error));
      } finally {
        this.resolveExit?.();
      }
    }
  }

  private buildView(): ViewRefs {
    const {renderer} = this.options;
    const root = new BoxRenderable(renderer, {
      id: "blupost",
      width: "100%",
      height: "100%",
      flexDirection: "column",
      backgroundColor: blupostTheme.background
    });
    const header = new BoxRenderable(renderer, {
      width: "100%",
      height: 3,
      flexDirection: "row",
      paddingX: 2,
      justifyContent: "space-between",
      alignItems: "center",
      backgroundColor: blupostTheme.canvas
    });
    const brand = new ImageRenderable(renderer, {
      id: "brand-mark",
      source: blupostMarkPng,
      width: 6,
      height: 3,
      fit: "fit",
      protocol: "auto"
    });
    const connection = new TextRenderable(renderer, {
      id: "connection-status",
      content: " ○ Disconnected ",
      fg: blupostTheme.warning,
      bg: blupostTheme.surfaceRaised,
      onMouseDown: event => {
        event.preventDefault();
        if (this.presentation.connection.canReconnect) void this.reconnect();
      }
    });
    header.add(brand);
    header.add(connection);

    const main = new BoxRenderable(renderer, {
      width: "100%",
      flexGrow: 1,
      flexDirection: "row"
    });
    const sidebar = new BoxRenderable(renderer, {
      id: "conversation-pane",
      width: 28,
      height: "100%",
      border: ["right"],
      borderStyle: "single",
      borderColor: blupostTheme.divider,
      flexDirection: "column",
      backgroundColor: blupostTheme.navSurface
    });
    const listHeader = new TextRenderable(renderer, {
      id: "conversation-list-heading",
      width: "100%",
      height: 2,
      paddingX: 2,
      content: "MESSAGES",
      fg: blupostTheme.textPrimary
    });
    const threadList = new ScrollBoxRenderable(renderer, {
      id: "conversation-list",
      width: "100%",
      flexGrow: 1,
      paddingX: 1,
      scrollY: true,
      scrollX: false,
      verticalScrollbarOptions: {visible: false, showArrows: false},
      horizontalScrollbarOptions: {visible: false, showArrows: false},
      viewportCulling: true,
      focusable: true,
      backgroundColor: blupostTheme.navSurface,
      onMouseDown: () => this.setFocus("list")
    });
    threadList.verticalScrollBar.visible = false;
    threadList.horizontalScrollBar.visible = false;
    const addContactButton = new TextRenderable(renderer, {
      id: "add-contact-button",
      height: 1,
      width: "100%",
      paddingX: 2,
      content: " ＋ Add contact       N ",
      fg: blupostTheme.postBlue,
      bg: blupostTheme.selectionIdle,
      onMouseDown: event => {
        event.preventDefault();
        this.openContactForm();
      },
      onMouseOver: () => {
        addContactButton.bg = blupostTheme.surfaceHover;
      },
      onMouseOut: () => {
        addContactButton.bg = blupostTheme.selectionIdle;
      }
    });
    const contactForm = new BoxRenderable(renderer, {
      id: "contact-form",
      width: "100%",
      flexGrow: 1,
      flexDirection: "column",
      paddingX: 2,
      backgroundColor: blupostTheme.navSurface,
      visible: false
    });
    const contactHeading = new TextRenderable(renderer, {
      height: 1,
      content: new StyledText([bold(fg(blupostTheme.postBlue)("▌ Add contact"))]),
      fg: blupostTheme.postBlue
    });
    const contactAliasLabel = new TextRenderable(renderer, {
      height: 1,
      content: "Alias",
      fg: blupostTheme.textSecondary
    });
    const contactAlias = new TextareaRenderable(renderer, {
      id: "contact-alias",
      height: 1,
      width: "100%",
      textColor: blupostTheme.text,
      focusedTextColor: blupostTheme.text,
      backgroundColor: blupostTheme.surfaceRaised,
      focusedBackgroundColor: blupostTheme.selectionFocus,
      cursorColor: blupostTheme.signalBright,
      paddingLeft: 1,
      placeholder: "friend",
      placeholderColor: blupostTheme.textTertiary,
      keyBindings: [
        {name: "return", action: "submit"},
        {name: "kpenter", action: "submit"},
        {name: "linefeed", action: "submit"}
      ],
      onSubmit: () => this.setContactControl("number")
    });
    const contactNumberLabel = new TextRenderable(renderer, {
      height: 1,
      marginTop: 1,
      content: "Phone number",
      fg: blupostTheme.textSecondary
    });
    const contactNumber = new TextareaRenderable(renderer, {
      id: "contact-number",
      height: 1,
      width: "100%",
      textColor: blupostTheme.text,
      focusedTextColor: blupostTheme.text,
      backgroundColor: blupostTheme.surfaceRaised,
      focusedBackgroundColor: blupostTheme.selectionFocus,
      cursorColor: blupostTheme.signalBright,
      paddingLeft: 1,
      placeholder: "+1…",
      placeholderColor: blupostTheme.textTertiary,
      keyBindings: [
        {name: "return", action: "submit"},
        {name: "kpenter", action: "submit"},
        {name: "linefeed", action: "submit"}
      ],
      onSubmit: () => this.submitContact()
    });
    const contactError = new TextRenderable(renderer, {
      id: "contact-error",
      height: 0,
      width: "100%",
      content: "",
      fg: blupostTheme.error,
      wrapMode: "word",
      visible: false
    });
    const contactDisclosure = new TextRenderable(renderer, {
      height: 3,
      width: "100%",
      marginTop: 1,
      content: "Saved locally in your Blupost config.",
      fg: blupostTheme.textTertiary,
      wrapMode: "word"
    });
    const contactActions = new BoxRenderable(renderer, {
      height: 1,
      width: "100%",
      flexDirection: "row"
    });
    const saveContactButton = new TextRenderable(renderer, {
      id: "save-contact-button",
      width: 16,
      content: " Save contact ",
      fg: blupostTheme.textPrimary,
      bg: blupostTheme.selectionIdle,
      onMouseDown: event => {
        event.preventDefault();
        this.setContactControl("save");
        this.submitContact();
      }
    });
    const cancelContactButton = new TextRenderable(renderer, {
      id: "cancel-contact-button",
      content: " Cancel ",
      fg: blupostTheme.textSecondary,
      bg: blupostTheme.navSurface,
      onMouseDown: event => {
        event.preventDefault();
        this.setContactControl("cancel");
        this.cancelContactForm();
      }
    });
    contactActions.add(saveContactButton);
    contactActions.add(cancelContactButton);
    contactForm.add(contactHeading);
    contactForm.add(contactAliasLabel);
    contactForm.add(contactAlias);
    contactForm.add(contactNumberLabel);
    contactForm.add(contactNumber);
    contactForm.add(contactError);
    contactForm.add(contactDisclosure);
    contactForm.add(contactActions);
    sidebar.add(listHeader);
    sidebar.add(threadList);
    sidebar.add(addContactButton);
    sidebar.add(contactForm);

    const chat = new BoxRenderable(renderer, {
      id: "conversation-detail",
      height: "100%",
      flexGrow: 1,
      flexDirection: "column"
    });
    const chatHeader = new BoxRenderable(renderer, {
      height: 3,
      width: "100%",
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingX: 2,
      border: ["bottom"],
      borderStyle: "single",
      borderColor: blupostTheme.divider
    });
    const backButton = new TextRenderable(renderer, {
      id: "back-button",
      content: "‹ Conversations",
      fg: blupostTheme.cyan,
      marginRight: 2,
      visible: false,
      onMouseDown: event => {
        event.preventDefault();
        this.showConversationList();
      }
    });
    const conversationTitle = new TextRenderable(renderer, {
      id: "conversation-title",
      content: "Choose a conversation",
      fg: blupostTheme.textPrimary,
      flexGrow: 1,
      truncate: true
    });
    const sessionLabel = new TextRenderable(renderer, {
      content: " SESSION ONLY ",
      fg: blupostTheme.textTertiary,
      bg: blupostTheme.surfaceRaised
    });
    chatHeader.add(backButton);
    chatHeader.add(conversationTitle);
    chatHeader.add(sessionLabel);

    const transcript = new ScrollBoxRenderable(renderer, {
      id: "transcript",
      width: "100%",
      flexGrow: 1,
      paddingX: 1,
      paddingY: 1,
      scrollY: true,
      scrollX: false,
      stickyScroll: true,
      stickyStart: "bottom",
      verticalScrollbarOptions: {visible: false, showArrows: false},
      horizontalScrollbarOptions: {visible: false, showArrows: false},
      viewportCulling: true,
      focusable: true,
      backgroundColor: blupostTheme.canvas,
      onMouseDown: () => this.setFocus("transcript")
    });
    transcript.verticalScrollBar.visible = false;
    transcript.horizontalScrollBar.visible = false;
    const newMessageNotice = new TextRenderable(renderer, {
      id: "new-message-notice",
      width: "100%",
      height: 0,
      paddingX: 2,
      content: "",
      fg: blupostTheme.postBlue,
      bg: blupostTheme.selectionIdle,
      visible: false,
      onMouseDown: event => {
        event.preventDefault();
        this.jumpToLatest();
      }
    });
    const composerBox = new BoxRenderable(renderer, {
      id: "composer-region",
      width: "100%",
      height: 3,
      flexDirection: "column",
      border: ["top"],
      borderStyle: "single",
      borderColor: blupostTheme.borderSoft,
      paddingX: 1,
      backgroundColor: blupostTheme.surfaceRaised
    });
    const composerLabel = new TextRenderable(renderer, {
      height: 1,
      width: "100%",
      content: "Message",
      fg: blupostTheme.textSecondary,
      truncate: true
    });
    const composerRow = new BoxRenderable(renderer, {
      height: 1,
      width: "100%",
      flexDirection: "row",
      alignItems: "center"
    });
    const composer = new TextareaRenderable(renderer, {
      id: "composer",
      flexGrow: 1,
      height: "100%",
      textColor: blupostTheme.text,
      focusedTextColor: blupostTheme.text,
      placeholder: "Type a message…",
      placeholderColor: blupostTheme.faint,
      backgroundColor: blupostTheme.surfaceRaised,
      wrapMode: "word",
      keyBindings: [
        {name: "return", action: "submit"},
        {name: "kpenter", action: "submit"},
        {name: "linefeed", action: "submit"},
        {name: "return", shift: true, action: "newline"},
        {name: "kpenter", shift: true, action: "newline"}
      ],
      onKeyDown: key => {
        if (key.name === "escape") {
          key.preventDefault();
          this.setFocus("transcript");
        } else if (key.name === "tab") {
          key.preventDefault();
          this.moveFocus(key.shift ? -1 : 1);
        }
      },
      onSubmit: () => this.submitMessage(),
      onContentChange: () => this.rememberDraft()
    });
    const sendButton = new TextRenderable(renderer, {
      id: "send-button",
      content: " Send ↵ ",
      fg: blupostTheme.faint,
      bg: blupostTheme.selectionIdle,
      width: 10,
      onMouseDown: event => {
        event.preventDefault();
        this.submitMessage();
      },
      onMouseOver: () => {
        const canSend =
          this.presentation.connection.isConnected &&
          !this.sendInFlight &&
          Boolean(composer.plainText.trim());
        sendButton.bg = canSend ? blupostTheme.signalCyan : blupostTheme.surfaceHover;
      },
      onMouseOut: () => {
        const canSend =
          this.presentation.connection.isConnected &&
          !this.sendInFlight &&
          Boolean(composer.plainText.trim());
        sendButton.bg = canSend ? blupostTheme.postBlue : blupostTheme.selectionIdle;
      }
    });
    const composerNote = new TextRenderable(renderer, {
      height: 0,
      width: "100%",
      content: "",
      fg: blupostTheme.warning,
      wrapMode: "word",
      visible: false
    });
    composerRow.add(composer);
    composerRow.add(sendButton);
    composerBox.add(composerLabel);
    composerBox.add(composerRow);
    composerBox.add(composerNote);
    chat.add(chatHeader);
    chat.add(transcript);
    chat.add(newMessageNotice);
    chat.add(composerBox);

    const helpPanel = new ScrollBoxRenderable(renderer, {
      id: "help-panel",
      width: "100%",
      height: "100%",
      paddingX: 2,
      paddingY: 1,
      scrollY: true,
      scrollX: false,
      verticalScrollbarOptions: {visible: false, showArrows: false},
      horizontalScrollbarOptions: {visible: false, showArrows: false},
      viewportCulling: true,
      focusable: true,
      backgroundColor: blupostTheme.canvas,
      visible: false
    });
    helpPanel.verticalScrollBar.visible = false;
    helpPanel.horizontalScrollBar.visible = false;
    const paletteOverlay = new BoxRenderable(renderer, {
      id: "command-palette-overlay",
      width: "100%",
      height: "100%",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: blupostTheme.canvas,
      onMouseDown: event => event.preventDefault(),
      visible: false
    });
    const palettePanel = new BoxRenderable(renderer, {
      id: "command-palette",
      width: "70%",
      height: 14,
      maxWidth: 72,
      flexDirection: "column",
      paddingX: 1,
      paddingY: 1,
      border: true,
      borderStyle: "single",
      borderColor: blupostTheme.signalBright,
      backgroundColor: blupostTheme.surfaceRaised
    });
    palettePanel.add(
      new TextRenderable(renderer, {
        height: 1,
        content: "COMMANDS",
        fg: blupostTheme.signalCyan
      })
    );
    const paletteSearch = new TextareaRenderable(renderer, {
      id: "command-palette-search",
      width: "100%",
      height: 1,
      marginTop: 1,
      textColor: blupostTheme.textPrimary,
      focusedTextColor: blupostTheme.textPrimary,
      placeholder: "Find a contact or command…",
      placeholderColor: blupostTheme.textTertiary,
      backgroundColor: blupostTheme.selectionIdle,
      keyBindings: [
        {name: "return", action: "submit"},
        {name: "kpenter", action: "submit"},
        {name: "linefeed", action: "submit"}
      ],
      onSubmit: () => this.runPaletteSelection(),
      onContentChange: () => {
        if (this.ignoredPaletteValue !== undefined) {
          const ignored = this.ignoredPaletteValue;
          this.ignoredPaletteValue = undefined;
          if (paletteSearch.plainText === ignored) return;
        }
        this.paletteSelection = 0;
        this.renderPalette();
        this.options.renderer.requestRender();
      }
    });
    const paletteResults = new ScrollBoxRenderable(renderer, {
      id: "command-palette-results",
      width: "100%",
      flexGrow: 1,
      marginTop: 1,
      scrollY: true,
      scrollX: false,
      verticalScrollbarOptions: {visible: false, showArrows: false},
      horizontalScrollbarOptions: {visible: false, showArrows: false},
      viewportCulling: true,
      focusable: true
    });
    paletteResults.verticalScrollBar.visible = false;
    paletteResults.horizontalScrollBar.visible = false;
    palettePanel.add(paletteSearch);
    palettePanel.add(paletteResults);
    paletteOverlay.add(palettePanel);
    main.add(sidebar);
    main.add(chat);
    main.add(helpPanel);
    main.add(paletteOverlay);

    const footer = new BoxRenderable(renderer, {
      width: "100%",
      height: 1,
      flexDirection: "row",
      paddingX: 2,
      justifyContent: "space-between",
      backgroundColor: blupostTheme.navSurface
    });
    const modeBadge = new TextRenderable(renderer, {
      id: "focus-mode",
      height: 1,
      width: 9,
      content: " INBOX ",
      fg: blupostTheme.inverseText,
      bg: blupostTheme.postBlue
    });
    const status = new TextRenderable(renderer, {
      id: "context-keybar",
      height: 1,
      flexGrow: 1,
      content: "↑↓ Move  Enter Open  a Add",
      fg: blupostTheme.textSecondary,
      paddingLeft: 1,
      truncate: true
    });
    const sessionCount = new TextRenderable(renderer, {
      height: 1,
      content: "",
      fg: blupostTheme.textTertiary
    });
    const helpButton = new TextRenderable(renderer, {
      id: "help-button",
      height: 1,
      width: 8,
      content: " ?  Help ",
      fg: blupostTheme.textPrimary,
      bg: blupostTheme.selectionIdle,
      onMouseDown: event => {
        event.preventDefault();
        if (this.focusContext === "help") this.closeHelp();
        else this.openHelp();
      }
    });
    footer.add(modeBadge);
    footer.add(status);
    footer.add(sessionCount);
    footer.add(helpButton);
    root.add(header);
    root.add(main);
    root.add(footer);

    return {
      root,
      header,
      brand,
      connection,
      main,
      sidebar,
      listHeader,
      threadList,
      addContactButton,
      contactForm,
      contactAlias,
      contactNumberLabel,
      contactNumber,
      contactDisclosure,
      contactError,
      saveContactButton,
      cancelContactButton,
      chat,
      chatHeader,
      backButton,
      conversationTitle,
      sessionLabel,
      transcript,
      newMessageNotice,
      composerBox,
      composerLabel,
      composerRow,
      composer,
      sendButton,
      composerNote,
      helpPanel,
      paletteOverlay,
      palettePanel,
      paletteSearch,
      paletteResults,
      footer,
      modeBadge,
      status,
      sessionCount,
      helpButton
    };
  }

  private handleEngineEvent = (event: EngineEvent): void => {
    if (event.type === "snapshot") {
      const previousMessages = new Map(
        snapshotMessages(this.snapshot).map(message => [message.id, message.state])
      );
      const latestId = Math.max(
        0,
        ...event.snapshot.session.threads.flatMap(thread =>
          thread.messages.map(message => message.id)
        )
      );
      this.lastMessageId = latestId;
      const previousThread = this.snapshot.session.active_thread;
      const previousScrollTop = this.refs.transcript.scrollTop;
      const wasAtLatest = this.transcriptAtLatest();
      const previousLatestId = previousThread
        ? Math.max(
            0,
            ...(this.snapshot.session.threads
              .find(thread => thread.participant === previousThread)
              ?.messages.map(message => message.id) ?? [])
          )
        : 0;
      const wasConnecting = this.presentation.connection.isConnecting;
      const firstSnapshot = !this.hasReceivedSnapshot;
      this.hasReceivedSnapshot = true;
      this.snapshot = event.snapshot;
      this.presentation = createBlupostPresentation(
        this.snapshot,
        this.spinner,
        this.sendingSpinner
      );

      const activeThread = previousThread
        ? event.snapshot.session.threads.find(
            thread => thread.participant === previousThread
          )
        : undefined;
      const newIncoming =
        previousThread === event.snapshot.session.active_thread
          ? (activeThread?.messages.filter(
              message =>
                message.id > previousLatestId && message.direction === "incoming"
            ).length ?? 0)
          : 0;
      const preserveScroll = newIncoming > 0 && !wasAtLatest;
      if (preserveScroll && previousThread) {
        this.newMessageCount += newIncoming;
        this.newMessageThread = previousThread;
      } else if (
        newIncoming > 0 ||
        previousThread !== event.snapshot.session.active_thread
      ) {
        this.clearNewMessageNotice();
      }

      if (previousThread !== event.snapshot.session.active_thread) {
        this.changeComposerThread(event.snapshot.session.active_thread);
        this.composerError = "";
      }
      this.syncSelectedThread(firstSnapshot);

      const shouldOpen =
        this.pendingOpenThread !== null &&
        this.pendingOpenThread === event.snapshot.session.active_thread;
      if (shouldOpen) {
        this.pendingOpenThread = null;
        this.compactPane = "chat";
      } else if (
        firstSnapshot &&
        !this.layout.showSidebar &&
        event.snapshot.session.active_thread
      ) {
        this.compactPane = "chat";
      }

      if (!wasConnecting && this.presentation.connection.isConnecting) {
        this.startConnectionPulse();
      }
      if (!this.presentation.connection.isConnecting) {
        this.motion.cancel("connection-pulse", true);
      }
      this.render();
      this.syncMessageFeedback(previousMessages, firstSnapshot);
      if (preserveScroll) this.refs.transcript.scrollTop = previousScrollTop;
      if (shouldOpen) this.setFocus("composer");
    } else if (event.type === "error") {
      this.setNotice(event.message, "error");
    }
  };

  private syncSelectedThread(firstSnapshot: boolean): void {
    const available = this.presentation.conversations.map(item => item.number);
    if (this.selectedThread && available.includes(this.selectedThread)) return;
    this.selectedThread =
      this.snapshot.session.active_thread ?? available.at(0) ?? null;
    if (firstSnapshot && this.snapshot.session.active_thread) {
      this.selectedThread = this.snapshot.session.active_thread;
    }
  }

  private render(): void {
    this.presentation = createBlupostPresentation(
      this.snapshot,
      this.spinner,
      this.sendingSpinner
    );
    this.renderConnection();
    this.renderThreads();
    this.renderConversation();
    this.renderNewMessageNotice();
    this.renderContactForm();
    this.renderHelp();
    this.renderPalette();
    this.renderVisibility();
    this.renderFooter();
    this.applyComposerHeight();
    this.options.renderer.requestRender();
  }

  private startBrandReveal(): void {
    this.refs.brand.opacity = 0.35;
    this.motion.animate("brand-reveal", 200, progress => {
      if (this.stopped) return;
      this.refs.brand.opacity = 0.35 + progress * 0.65;
    });
  }

  private syncMessageFeedback(
    previousMessages: ReadonlyMap<number, MessageState>,
    firstSnapshot: boolean
  ): void {
    const messages = snapshotMessages(this.snapshot);
    const hasSending = messages.some(message => message.state === "sending");
    if (hasSending && !this.sendingMotionActive) {
      this.sendingMotionActive = true;
      const frames = ["◌", "◔", "◑", "◕"] as const;
      this.motion.repeat("message-sending", 560, progress => {
        this.sendingSpinner =
          frames[Math.min(frames.length - 1, Math.floor(progress * frames.length))] ??
          "◌";
        for (const message of snapshotMessages(this.snapshot)) {
          if (message.state === "sending") this.applyMessageFeedback(message.id);
        }
      });
    } else if (!hasSending && this.sendingMotionActive) {
      this.sendingMotionActive = false;
      this.motion.cancel("message-sending", true);
    }

    if (firstSnapshot) return;
    const activeThread = this.snapshot.session.active_thread;
    const incomingThreads = new Set<string>();
    for (const message of messages) {
      if (message.direction === "incoming" && !previousMessages.has(message.id)) {
        incomingThreads.add(message.participant);
        if (message.participant === activeThread) {
          this.startIncomingSettle(message.id);
        }
      }
      if (message.state === "sent" && previousMessages.get(message.id) !== "sent") {
        this.startSentSettle(message.id);
      }
    }
    for (const participant of incomingThreads) {
      this.startIncomingThreadSettle(participant);
    }
  }

  private startIncomingSettle(messageId: number): void {
    this.incomingSettle.set(messageId, 0);
    this.motion.animate(
      `incoming-${messageId}`,
      240,
      progress => {
        this.incomingSettle.set(messageId, progress);
        this.applyMessageFeedback(messageId);
      },
      () => {
        this.incomingSettle.delete(messageId);
        this.applyMessageFeedback(messageId);
      }
    );
  }

  private startSentSettle(messageId: number): void {
    this.sentSettle.set(messageId, 0);
    this.motion.animate(
      `sent-${messageId}`,
      800,
      progress => {
        this.sentSettle.set(messageId, progress);
        this.applyMessageFeedback(messageId);
      },
      () => {
        this.sentSettle.delete(messageId);
        this.applyMessageFeedback(messageId);
      }
    );
  }

  private startIncomingThreadSettle(participant: string): void {
    this.incomingThreadSettle.set(participant, 0);
    this.motion.animate(
      `incoming-thread-${participant}`,
      240,
      progress => {
        this.incomingThreadSettle.set(participant, progress);
        this.applyIncomingThreadFeedback(participant);
      },
      () => {
        this.incomingThreadSettle.delete(participant);
        this.applyIncomingThreadFeedback(participant);
      }
    );
  }

  private applyIncomingThreadFeedback(participant: string): void {
    const row = this.threadRows.get(participant);
    const base = this.threadRowBaseColors.get(participant);
    if (row && base) {
      const progress = this.incomingThreadSettle.get(participant);
      row.backgroundColor =
        progress === undefined
          ? base
          : mixHexColors(blupostTheme.selectionFocus, base, progress);
    }
    if (this.snapshot.session.active_thread === participant) {
      const progress = this.incomingThreadSettle.get(participant);
      this.refs.newMessageNotice.fg =
        progress === undefined
          ? blupostTheme.postBlue
          : mixHexColors(blupostTheme.signalBright, blupostTheme.postBlue, progress);
    }
  }

  private applyMessageFeedback(messageId: number): void {
    const message = snapshotMessages(this.snapshot).find(
      candidate => candidate.id === messageId
    );
    if (!message) return;
    const surface = this.messageSurfaces.get(messageId);
    if (surface && message.direction === "incoming") {
      const progress = this.incomingSettle.get(messageId);
      surface.borderColor =
        progress === undefined
          ? blupostTheme.messageIncomingRail
          : mixHexColors(
              blupostTheme.signalBright,
              blupostTheme.messageIncomingRail,
              progress
            );
    }
    const outcome = this.messageOutcomes.get(messageId);
    if (!outcome) return;
    if (message.state === "sending") {
      outcome.content = `${this.sendingSpinner} Sending…`;
      outcome.fg = blupostTheme.signalCyan;
      return;
    }
    if (message.state === "sent") {
      const progress = this.sentSettle.get(messageId);
      outcome.fg =
        progress === undefined
          ? blupostTheme.textSecondary
          : mixHexColors(blupostTheme.success, blupostTheme.textSecondary, progress);
    }
  }

  private renderConnection(): void {
    const {connection} = this.presentation;
    const label = this.layout.showPhoneName
      ? connection.label
      : connection.compactLabel;
    this.refs.connection.content = ` ${label} `;
    this.refs.connection.fg = connection.isConnected
      ? blupostTheme.signalCyan
      : toneColor(connection.tone);
    this.refs.connection.bg = blupostTheme.surfaceRaised;
  }

  private renderThreads(): void {
    this.threadRows.clear();
    this.threadRowBaseColors.clear();
    clearChildren(this.refs.threadList);
    const focused = this.focusContext === "list";
    const conversationCount = this.presentation.conversations.length;
    this.refs.listHeader.content = new StyledText([
      bold(
        fg(focused ? blupostTheme.postBlue : blupostTheme.textPrimary)(
          focused ? "▌ MESSAGES" : "MESSAGES"
        )
      ),
      fg(blupostTheme.textTertiary)(
        `\n${conversationCount} ${conversationCount === 1 ? "contact" : "contacts"}`
      )
    ]);

    if (this.presentation.conversations.length === 0) {
      this.refs.threadList.add(
        new TextRenderable(this.options.renderer, {
          content: this.layout.showSecondaryHints
            ? "No conversations yet\n\nAdd someone to start a session-only conversation."
            : "No conversations yet\n\nAdd someone to begin.",
          fg: blupostTheme.textTertiary,
          wrapMode: "word",
          paddingX: this.layout.horizontalPadding
        })
      );
      return;
    }

    for (const [index, conversation] of this.presentation.conversations.entries()) {
      const selected = this.selectedThread === conversation.number;
      const active = this.snapshot.session.active_thread === conversation.number;
      const showPreview = this.layout.showThreadPreview;
      const baseColor = selected
        ? focused
          ? blupostTheme.selectionFocus
          : blupostTheme.selectionIdle
        : active
          ? blupostTheme.selectionIdle
          : blupostTheme.navSurface;
      const incomingProgress = this.incomingThreadSettle.get(conversation.number);
      const row = new BoxRenderable(this.options.renderer, {
        id: `thread-row-${index}`,
        width: "100%",
        height: this.layout.tier === "roomy" ? 3 : showPreview ? 2 : 1,
        flexDirection: "column",
        paddingX: this.layout.horizontalPadding,
        backgroundColor:
          incomingProgress === undefined
            ? baseColor
            : mixHexColors(blupostTheme.selectionFocus, baseColor, incomingProgress),
        onMouseDown: event => {
          event.preventDefault();
          this.selectedThread = conversation.number;
          this.openThread(conversation.number);
        },
        onMouseOver: () => {
          if (!selected && !active) row.backgroundColor = blupostTheme.surfaceHover;
        },
        onMouseOut: () => {
          if (!selected && !active) row.backgroundColor = blupostTheme.navSurface;
        }
      });
      this.threadRows.set(conversation.number, row);
      this.threadRowBaseColors.set(conversation.number, baseColor);
      const top = new BoxRenderable(this.options.renderer, {
        width: "100%",
        height: 1,
        flexDirection: "row",
        justifyContent: "space-between"
      });
      const marker = active ? "▌" : selected ? "›" : " ";
      const label = new TextRenderable(this.options.renderer, {
        flexGrow: 1,
        content: new StyledText([
          fg(active || selected ? blupostTheme.postBlue : blupostTheme.textTertiary)(
            `${marker} `
          ),
          (selected || active || conversation.unread
            ? bold
            : (value: TextChunk) => value)(
            fg(
              selected || active || conversation.unread
                ? blupostTheme.textPrimary
                : blupostTheme.textSecondary
            )(conversation.label)
          )
        ]),
        truncate: true
      });
      const priority = conversation.unread
        ? String(conversation.unread)
        : conversation.hasDraft
          ? "Draft"
          : "";
      const metadata = new TextRenderable(this.options.renderer, {
        content: priority
          ? conversation.unread
            ? ` ${priority} `
            : ` ${priority.toLowerCase()} `
          : "",
        fg: conversation.unread ? blupostTheme.inverseText : blupostTheme.warning,
        bg: conversation.unread
          ? blupostTheme.postBlue
          : priority
            ? blupostTheme.selectionIdle
            : blupostTheme.navSurface
      });
      top.add(label);
      top.add(metadata);
      row.add(top);
      if (showPreview) {
        row.add(
          new TextRenderable(this.options.renderer, {
            height: 1,
            content: `  ${conversation.preview ?? ""}`,
            fg: blupostTheme.textTertiary,
            truncate: true
          })
        );
      }
      this.refs.threadList.add(row);
    }
  }

  private renderConversation(): void {
    this.messageSurfaces.clear();
    this.messageOutcomes.clear();
    clearChildren(this.refs.transcript);
    const active = this.presentation.activeConversation;
    this.refs.backButton.visible = !this.layout.showSidebar;
    this.refs.backButton.content =
      this.layout.tier === "tiny" ? "‹ Back" : "‹ Conversations";
    this.refs.sessionLabel.visible =
      this.layout.showSecondaryHints && this.layout.showSidebar;
    const conversationLabel = active?.label ?? "Choose a conversation";
    const conversationFocused =
      this.focusContext === "transcript" || this.focusContext === "composer";
    const subtitle =
      active && this.layout.chatHeaderHeight >= 3 ? "\nSession messages" : "";
    this.refs.conversationTitle.content = new StyledText([
      bold(
        fg(conversationFocused ? blupostTheme.signalBright : blupostTheme.textPrimary)(
          `${this.focusContext === "transcript" ? "▌ " : ""}${conversationLabel}`
        )
      ),
      fg(blupostTheme.textTertiary)(subtitle)
    ]);

    if (!active) {
      this.refs.transcript.add(
        new TextRenderable(this.options.renderer, {
          content:
            "Start a conversation\n\nChoose someone from Messages. This session stays on this machine.",
          fg: blupostTheme.textTertiary,
          wrapMode: "word"
        })
      );
      this.refs.composerBox.visible = false;
      return;
    }

    this.refs.composerBox.visible = true;
    if (active.groups.length === 0) {
      this.refs.transcript.add(
        new TextRenderable(this.options.renderer, {
          content: `No messages with ${active.label} in this session`,
          fg: blupostTheme.text,
          wrapMode: "word"
        })
      );
      this.refs.transcript.add(
        new TextRenderable(this.options.renderer, {
          marginTop: 1,
          content: "Messages appear here only while Blupost is open.",
          fg: blupostTheme.faint,
          wrapMode: "word"
        })
      );
    } else {
      for (const group of active.groups) {
        const outgoing = group.direction === "outgoing";
        const groupView = new BoxRenderable(this.options.renderer, {
          width: "100%",
          flexDirection: "column",
          alignItems: outgoing ? "flex-end" : "flex-start",
          marginBottom: 1
        });
        groupView.add(
          new TextRenderable(this.options.renderer, {
            content: outgoing ? "You ▐" : `▌ ${group.label}`,
            fg: outgoing ? blupostTheme.postBlue : blupostTheme.textSecondary,
            marginBottom: 0
          })
        );
        for (const message of group.messages) {
          groupView.add(this.messageView(message, outgoing));
        }
        this.refs.transcript.add(groupView);
      }
    }
    this.renderComposerState();
  }

  private messageView(message: MessagePresentation, outgoing: boolean): BoxRenderable {
    const box = new BoxRenderable(this.options.renderer, {
      flexDirection: "column",
      alignItems: outgoing ? "flex-end" : "flex-start",
      marginBottom: 0
    });
    const surface = new BoxRenderable(this.options.renderer, {
      id: `message-surface-${message.id}`,
      maxWidth:
        this.layout.tier === "roomy"
          ? "68%"
          : this.layout.tier === "standard"
            ? "74%"
            : this.layout.tier === "compact"
              ? "88%"
              : "100%",
      flexDirection: "column",
      alignItems: outgoing ? "flex-end" : "flex-start",
      paddingX: 1,
      border: outgoing ? ["right"] : ["left"],
      borderStyle: "single",
      borderColor: outgoing
        ? blupostTheme.postBlue
        : this.incomingSettle.has(message.id)
          ? mixHexColors(
              blupostTheme.signalBright,
              blupostTheme.messageIncomingRail,
              this.incomingSettle.get(message.id) ?? 1
            )
          : blupostTheme.messageIncomingRail,
      backgroundColor: outgoing ? blupostTheme.messageOutgoing : blupostTheme.canvas
    });
    surface.add(
      new TextRenderable(this.options.renderer, {
        id: `message-body-${message.id}`,
        content: linkifyMessage(message.body),
        fg: outgoing ? blupostTheme.outgoing : blupostTheme.textPrimary,
        selectionBg: blupostTheme.signalCyan,
        selectionFg: blupostTheme.inverseText,
        wrapMode: "word"
      })
    );
    this.messageSurfaces.set(message.id, surface);
    box.add(surface);
    if (message.outcome) {
      const outcome = new TextRenderable(this.options.renderer, {
        id: `message-outcome-${message.id}`,
        content: message.outcome,
        fg:
          message.state === "sending"
            ? blupostTheme.signalCyan
            : this.sentSettle.has(message.id)
              ? mixHexColors(
                  blupostTheme.success,
                  blupostTheme.textSecondary,
                  this.sentSettle.get(message.id) ?? 1
                )
              : toneColor(message.outcomeTone),
        bg:
          message.outcomeTone === "error" || message.outcomeTone === "warning"
            ? blupostTheme.surfaceRaised
            : blupostTheme.canvas,
        wrapMode: "word"
      });
      this.messageOutcomes.set(message.id, outcome);
      box.add(outcome);
    }
    return box;
  }

  private renderComposerState(): void {
    const active = this.presentation.activeConversation;
    if (!active) return;
    const canSend =
      this.presentation.connection.isConnected &&
      !this.sendInFlight &&
      Boolean(this.refs.composer.plainText.trim());
    this.refs.composerLabel.visible = this.layout.showComposerLabel;
    this.refs.composerLabel.content = new StyledText([
      bg(
        this.focusContext === "composer"
          ? blupostTheme.postBlue
          : blupostTheme.selectionIdle
      )(
        fg(
          this.focusContext === "composer"
            ? blupostTheme.inverseText
            : blupostTheme.textSecondary
        )(" TO ")
      ),
      bold(fg(blupostTheme.textPrimary)(` ${active.label}`))
    ]);
    this.refs.composer.placeholder = `Message ${active.label}…`;
    this.refs.sendButton.content = this.sendInFlight
      ? " Sending… "
      : this.layout.tier === "tiny"
        ? " Send "
        : " Send ↵ ";
    this.refs.sendButton.width = this.sendInFlight
      ? 11
      : this.layout.tier === "tiny"
        ? 7
        : 10;
    this.refs.sendButton.fg = canSend
      ? blupostTheme.inverseText
      : blupostTheme.textTertiary;
    this.refs.sendButton.bg = canSend
      ? blupostTheme.postBlue
      : blupostTheme.selectionIdle;
    this.refs.composerBox.borderColor =
      this.focusContext === "composer"
        ? blupostTheme.signalBright
        : blupostTheme.divider;

    const connectionNote = this.presentation.connection.isConnected
      ? ""
      : this.presentation.connection.isConnecting
        ? "Draft stays here while connecting · nothing will queue"
        : "Draft stays here · nothing will queue";
    const note = this.composerError || connectionNote;
    this.refs.composerNote.content = note;
    this.refs.composerNote.fg = this.composerError
      ? blupostTheme.error
      : blupostTheme.warning;
    this.refs.composerNote.visible = Boolean(note);
  }

  private renderNewMessageNotice(): void {
    const active = this.snapshot.session.active_thread;
    const visible =
      this.newMessageCount > 0 && active !== null && this.newMessageThread === active;
    this.refs.newMessageNotice.visible = visible;
    this.refs.newMessageNotice.height = visible ? 1 : 0;
    this.refs.newMessageNotice.content = visible
      ? `↓ ${this.newMessageCount} new message${this.newMessageCount === 1 ? "" : "s"} · End to latest`
      : "";
    const progress = active ? this.incomingThreadSettle.get(active) : undefined;
    this.refs.newMessageNotice.fg =
      progress === undefined
        ? blupostTheme.postBlue
        : mixHexColors(blupostTheme.signalBright, blupostTheme.postBlue, progress);
  }

  private clearNewMessageNotice(): void {
    this.newMessageCount = 0;
    this.newMessageThread = null;
  }

  private transcriptAtLatest(): boolean {
    const latestTop = Math.max(
      0,
      this.refs.transcript.scrollHeight - this.refs.transcript.viewport.height
    );
    return this.refs.transcript.scrollTop >= latestTop - 1;
  }

  private jumpToLatest(): void {
    this.clearNewMessageNotice();
    this.renderNewMessageNotice();
    this.refs.transcript.stickyScroll = true;
    this.refs.transcript.scrollTo(this.refs.transcript.scrollHeight);
    this.applyComposerHeight();
    this.options.renderer.requestRender();
  }

  private renderContactForm(): void {
    this.refs.listHeader.visible = !this.contactFormOpen;
    this.refs.threadList.visible = !this.contactFormOpen;
    this.refs.addContactButton.visible = !this.contactFormOpen;
    this.refs.contactForm.visible = this.contactFormOpen;
    this.refs.contactError.visible = Boolean(this.contactError);
    this.refs.contactError.height = this.contactError ? 2 : 0;
    this.refs.contactError.content = this.contactError;
    this.refs.contactDisclosure.content =
      this.layout.tier === "tiny"
        ? "Saved locally in Blupost config."
        : "Saved locally in your Blupost config.";
    this.refs.saveContactButton.content = this.contactSaveInFlight
      ? " Saving… "
      : this.contactControl === "save"
        ? "› Save contact "
        : " Save contact ";
    this.refs.saveContactButton.fg = this.contactSaveInFlight
      ? blupostTheme.textTertiary
      : this.contactControl === "save"
        ? blupostTheme.inverseText
        : blupostTheme.textPrimary;
    this.refs.saveContactButton.bg =
      this.contactControl === "save"
        ? blupostTheme.postBlue
        : blupostTheme.selectionIdle;
    this.refs.cancelContactButton.fg =
      this.contactControl === "cancel"
        ? blupostTheme.textPrimary
        : blupostTheme.textSecondary;
    this.refs.cancelContactButton.content =
      this.contactControl === "cancel" ? "› Cancel " : " Cancel ";
    this.refs.cancelContactButton.bg =
      this.contactControl === "cancel"
        ? blupostTheme.selectionFocus
        : blupostTheme.navSurface;
  }

  private renderHelp(): void {
    clearChildren(this.refs.helpPanel);
    if (this.focusContext !== "help") return;
    this.refs.helpPanel.add(
      new TextRenderable(this.options.renderer, {
        content: new StyledText([bold(fg(blupostTheme.postBlue)("▌ HELP"))]),
        fg: blupostTheme.postBlue,
        marginBottom: 1
      })
    );
    this.refs.helpPanel.add(
      new TextRenderable(this.options.renderer, {
        content: this.helpText(),
        fg: blupostTheme.textSecondary,
        selectionBg: blupostTheme.signalCyan,
        selectionFg: blupostTheme.inverseText,
        wrapMode: "word"
      })
    );
  }

  private helpText(): string {
    const contextHelp =
      this.helpReturnFocus === "list"
        ? `Conversation list
↑ / ↓ or j / k  Move selection
Enter             Open conversation
n or a            Add contact
c                 Reconnect when available`
        : this.helpReturnFocus === "transcript"
          ? `Transcript
↑ / ↓             Scroll one line
PageUp / PageDown Scroll one page
Home / End        Oldest / latest
Tab or i          Write a message`
          : `Composer
Enter             Send once
Shift+Enter       New line
Esc               Browse transcript

The active recipient is always shown above the composer.`;
    return `Messages are session-only and disappear when Blupost closes. Drafts are preserved per conversation.

${contextHelp}

Global
Tab / Shift+Tab   Move focus
Esc               Step back or close
?                 Open Help outside text entry
Ctrl+P            Open contacts and commands
Ctrl+C            Quit safely

Blupost never queues a disconnected send or retries a message automatically.

Links and clipboard writes are mediated by your terminal. Hold your terminal's mouse-selection modifier when native selection is preferred.`;
  }

  private paletteEntries(): PaletteEntry[] {
    const entries: PaletteEntry[] = [
      {
        kind: "add",
        label: "Add contact",
        description: "Save a contact on this machine"
      },
      ...(this.presentation.connection.canReconnect
        ? [
            {
              kind: "reconnect" as const,
              label: "Reconnect",
              description: "Connect to the nearby paired iPhone"
            }
          ]
        : []),
      {
        kind: "help",
        label: "Open help",
        description: "Show context-aware keys and session limits"
      },
      ...this.presentation.conversations.map(
        conversation =>
          ({
            kind: "thread",
            label: conversation.label,
            description: "Open conversation",
            number: conversation.number
          }) satisfies PaletteEntry
      )
    ];
    const query = this.refs.paletteSearch.plainText.trim().toLocaleLowerCase();
    if (!query) return entries;
    return entries.filter(entry =>
      `${entry.label} ${entry.description}`.toLocaleLowerCase().includes(query)
    );
  }

  private renderPalette(): void {
    clearChildren(this.refs.paletteResults);
    if (this.focusContext !== "palette") return;
    const entries = this.paletteEntries();
    this.paletteSelection = Math.min(
      Math.max(0, this.paletteSelection),
      Math.max(0, entries.length - 1)
    );
    if (entries.length === 0) {
      this.refs.paletteResults.add(
        new TextRenderable(this.options.renderer, {
          content: "No matching contacts or commands",
          fg: blupostTheme.textTertiary
        })
      );
      return;
    }
    const showDescriptions = this.layout.tier !== "tiny";
    const fullWidthPanel =
      this.layout.tier === "compact" || this.layout.tier === "tiny";
    const panelWidth = Math.min(
      72,
      fullWidthPanel
        ? this.options.renderer.terminalWidth
        : Math.ceil(this.options.renderer.terminalWidth * 0.7)
    );
    const resultWidth = Math.max(
      1,
      panelWidth - 2 - (this.layout.tier === "tiny" ? 0 : 2)
    );
    for (const [index, entry] of entries.entries()) {
      const selected = index === this.paletteSelection;
      const activate = (): void => {
        this.paletteSelection = index;
        this.runPaletteSelection();
      };
      const row = new BoxRenderable(this.options.renderer, {
        id: `palette-row-${index}`,
        width: resultWidth,
        height: showDescriptions ? 2 : 1,
        flexDirection: "column",
        paddingX: 1,
        backgroundColor: selected
          ? blupostTheme.selectionFocus
          : blupostTheme.surfaceRaised,
        onMouseDown: event => {
          event.preventDefault();
          activate();
        },
        onMouseOver: () => {
          if (!selected) row.backgroundColor = blupostTheme.surfaceHover;
        },
        onMouseOut: () => {
          if (!selected) row.backgroundColor = blupostTheme.surfaceRaised;
        }
      });
      row.add(
        new TextRenderable(this.options.renderer, {
          id: `palette-row-${index}-label`,
          content: `${selected ? "▌" : " "} ${entry.label}`,
          fg: selected ? blupostTheme.textPrimary : blupostTheme.textSecondary,
          truncate: true,
          onMouseDown: event => {
            event.preventDefault();
            activate();
          }
        })
      );
      if (showDescriptions) {
        row.add(
          new TextRenderable(this.options.renderer, {
            content: `  ${entry.description}`,
            fg: blupostTheme.textTertiary,
            truncate: true,
            onMouseDown: event => {
              event.preventDefault();
              activate();
            }
          })
        );
      }
      this.refs.paletteResults.add(row);
    }
    this.refs.paletteResults.scrollChildIntoView(
      `palette-row-${this.paletteSelection}`
    );
  }

  private openPalette(): void {
    if (this.focusContext === "palette") return;
    this.paletteReturnFocus = this.restorableFocus();
    this.paletteSelection = 0;
    this.ignoredPaletteValue = "";
    this.refs.paletteSearch.setText("");
    this.focusContext = "palette";
    this.render();
    this.applyFocus();
  }

  private closePalette(): void {
    if (this.focusContext !== "palette") return;
    this.setFocus(this.paletteReturnFocus);
  }

  private movePaletteSelection(delta: number): void {
    const entries = this.paletteEntries();
    if (entries.length === 0) return;
    this.paletteSelection = Math.min(
      entries.length - 1,
      Math.max(0, this.paletteSelection + delta)
    );
    this.renderPalette();
    this.options.renderer.requestRender();
  }

  private runPaletteSelection(): void {
    const entry = this.paletteEntries()[this.paletteSelection];
    if (!entry) return;
    const returnFocus = this.paletteReturnFocus;
    if (entry.kind === "thread") {
      this.focusContext = returnFocus;
      this.selectedThread = entry.number;
      this.openThread(entry.number);
      return;
    }
    if (entry.kind === "add") {
      this.focusContext = returnFocus;
      this.openContactForm();
      return;
    }
    if (entry.kind === "reconnect") {
      this.setFocus(returnFocus);
      void this.reconnect();
      return;
    }
    this.helpReturnFocus = returnFocus;
    this.focusContext = "help";
    this.render();
    this.applyFocus();
  }

  private renderVisibility(): void {
    const paletteOpen = this.focusContext === "palette";
    this.refs.paletteOverlay.visible = paletteOpen;
    if (paletteOpen) {
      this.refs.helpPanel.visible = false;
      this.refs.sidebar.visible = false;
      this.refs.chat.visible = false;
      return;
    }
    const helpOpen = this.focusContext === "help";
    this.refs.helpPanel.visible = helpOpen;
    if (helpOpen) {
      this.refs.sidebar.visible = false;
      this.refs.chat.visible = false;
      return;
    }

    if (this.layout.showSidebar) {
      this.refs.sidebar.visible = true;
      this.refs.chat.visible = true;
      return;
    }

    const showList = this.contactFormOpen || this.compactPane === "list";
    this.refs.sidebar.visible = showList;
    this.refs.chat.visible = !showList;
  }

  private renderFooter(): void {
    const chrome = createBlupostChrome(
      this.focusContext,
      this.layout.tier,
      this.presentation.connection.canReconnect
    );
    this.refs.modeBadge.content = ` ${chrome.modeLabel} `;
    this.refs.modeBadge.width = chrome.modeLabel.length + 2;
    this.refs.modeBadge.fg =
      chrome.modeTone === "neutral"
        ? blupostTheme.textPrimary
        : blupostTheme.inverseText;
    this.refs.modeBadge.bg =
      chrome.modeTone === "signal"
        ? blupostTheme.signalCyan
        : chrome.modeTone === "post"
          ? blupostTheme.postBlue
          : blupostTheme.selectionIdle;
    this.refs.status.content = this.noticeMessage
      ? this.noticeMessage
      : keyRibbonContent(chrome.actions);
    this.refs.status.fg = this.noticeMessage
      ? toneColor(this.noticeTone)
      : blupostTheme.textSecondary;
    this.refs.sessionCount.visible =
      this.layout.showSessionCount &&
      !this.noticeMessage &&
      this.focusContext !== "help" &&
      this.focusContext !== "palette";
    this.refs.sessionCount.content = this.refs.sessionCount.visible
      ? `${this.presentation.sessionMessageCount} SESSION  `
      : "";
    this.refs.helpButton.content =
      this.focusContext === "help"
        ? " Esc "
        : this.layout.tier === "tiny"
          ? " ? "
          : " ? Help ";
    this.refs.helpButton.width =
      this.focusContext === "help" ? 5 : this.layout.tier === "tiny" ? 3 : 8;
  }

  private applyComposerHeight(): void {
    if (!this.refs.composerBox.visible) return;
    const text = this.refs.composer.plainText;
    const detailWidth = this.layout.showSidebar
      ? this.options.renderer.terminalWidth - this.layout.sidebarWidth
      : this.options.renderer.terminalWidth;
    const inputWidth = Math.max(12, detailWidth - this.refs.sendButton.width - 4);
    const rows = text
      .split("\n")
      .reduce(
        (total, line) => total + Math.max(1, Math.ceil([...line].length / inputWidth)),
        0
      );
    const contentRows = Math.min(this.layout.composerMaxRows, rows);
    const noteRows = this.refs.composerNote.visible
      ? this.layout.tier === "tiny"
        ? 2
        : 1
      : 0;
    const labelRows = this.layout.showComposerLabel ? 1 : 0;
    this.refs.composerRow.height = contentRows;
    this.refs.composer.height = contentRows;
    this.refs.composerNote.height = noteRows;
    const minimumRows = this.layout.tier === "tiny" ? 3 : 4;
    this.refs.composerBox.height = Math.max(
      minimumRows,
      1 + labelRows + contentRows + noteRows
    );
  }

  private handleSelection = (selection: Selection): void => {
    if (
      selection.anchor.x === selection.focus.x &&
      selection.anchor.y === selection.focus.y
    ) {
      return;
    }
    const text = selection.getSelectedText();
    if (!text || !this.options.copyText) return;
    void this.copySelection(text);
  };

  private async copySelection(text: string): Promise<void> {
    try {
      const result = await this.options.copyText?.(text);
      if (this.stopped) return;
      this.setNotice(
        result === "terminal-attempted"
          ? "Selection sent to the terminal clipboard."
          : "Selection copied.",
        "muted"
      );
    } catch {
      if (!this.stopped) this.setNotice("The clipboard is unavailable.", "warning");
    }
  }

  private moveThread(delta: number): void {
    const conversations = this.presentation.conversations;
    if (conversations.length === 0) return;
    const current = conversations.findIndex(
      item => item.number === this.selectedThread
    );
    const start = current < 0 ? 0 : current;
    const next = Math.min(conversations.length - 1, Math.max(0, start + delta));
    const choice = conversations[next];
    if (!choice) return;
    this.selectedThread = choice.number;
    this.noticeMessage = "";
    this.renderThreads();
    this.renderFooter();
    this.refs.threadList.scrollChildIntoView(`thread-row-${next}`);
    this.options.renderer.requestRender();
  }

  private openSelectedThread(): void {
    if (this.selectedThread) this.openThread(this.selectedThread);
  }

  private openThread(number: string): void {
    this.selectedThread = number;
    this.noticeMessage = "";
    this.clearNewMessageNotice();
    if (this.snapshot.session.active_thread === number) {
      this.compactPane = "chat";
      this.setFocus("composer");
      return;
    }
    this.pendingOpenThread = number;
    void this.options.engine.setActiveThread(number).catch(error => {
      this.pendingOpenThread = null;
      this.reportError(error);
    });
    this.render();
  }

  private showConversationList(): void {
    this.compactPane = "list";
    this.setFocus("list");
  }

  private submitMessage(): void {
    const active = this.snapshot.session.active_thread;
    const body = this.refs.composer.plainText;
    if (!active) {
      this.setNotice("Choose a conversation before sending.", "warning");
      return;
    }
    if (!this.presentation.connection.isConnected) {
      this.setNotice("Not sent — the iPhone is disconnected.", "warning");
      return;
    }
    if (!body.trim()) return;
    if (this.sendInFlight) {
      this.composerError = "Wait for the current send attempt to finish.";
      this.render();
      return;
    }
    const previousLastMessageId = this.lastMessageId;
    this.composerError = "";
    this.noticeMessage = "";
    this.setComposerText("");
    this.sendInFlight = true;
    this.render();
    void this.finishSend(active, body, previousLastMessageId);
  }

  private openContactForm(): void {
    if (this.contactSaveInFlight || this.contactFormOpen) return;
    this.contactReturnFocus = this.restorableFocus();
    this.contactFormOpen = true;
    this.contactError = "";
    this.contactControl = "alias";
    this.refs.contactAlias.setText("");
    this.refs.contactNumber.setText("");
    this.compactPane = "list";
    this.focusContext = "contact";
    this.applyLayout();
    this.render();
    this.applyFocus();
  }

  private cancelContactForm(): void {
    if (this.contactSaveInFlight) {
      this.contactError = "Wait for the contact save to finish.";
      this.render();
      return;
    }
    this.closeContactForm(this.contactReturnFocus);
  }

  private closeContactForm(nextFocus: RestorableFocus): void {
    this.contactFormOpen = false;
    this.contactError = "";
    this.refs.contactAlias.blur();
    this.refs.contactNumber.blur();
    this.refs.contactAlias.setText("");
    this.refs.contactNumber.setText("");
    this.applyLayout();
    this.setFocus(nextFocus);
  }

  private submitContact(): void {
    if (!this.contactFormOpen || this.contactSaveInFlight) return;
    const alias = this.refs.contactAlias.plainText.trim();
    const number = this.refs.contactNumber.plainText.trim();
    if (!alias || !number) {
      this.contactError = "Enter both an alias and phone number.";
      this.render();
      return;
    }
    this.contactSaveInFlight = true;
    this.contactError = "";
    this.render();
    void this.finishContactSave(alias, number);
  }

  private async finishContactSave(alias: string, number: string): Promise<void> {
    try {
      await this.options.engine.addContact(alias, number);
      if (this.stopped) return;
      const saved = this.snapshot.contacts.find(
        contact => contact.alias === alias.toLowerCase()
      );
      this.contactSaveInFlight = false;
      this.closeContactForm("list");
      this.setNotice("Saved locally.", "success");
      if (saved) {
        this.selectedThread = saved.number;
        this.pendingOpenThread = saved.number;
        await this.options.engine.setActiveThread(saved.number);
      }
    } catch (error) {
      this.contactError = error instanceof Error ? error.message : String(error);
    } finally {
      this.contactSaveInFlight = false;
      if (!this.stopped) this.render();
    }
  }

  private startConnectionPulse(): void {
    const frames = ["◌", "◔", "◑", "◕", "●"];
    this.motion.repeat("connection-pulse", 620, progress => {
      this.spinner =
        frames[Math.min(frames.length - 1, Math.floor(progress * frames.length))] ??
        "◌";
      if (this.stopped) return;
      this.presentation = createBlupostPresentation(
        this.snapshot,
        this.spinner,
        this.sendingSpinner
      );
      this.renderConnection();
    });
  }

  private openHelp(): void {
    this.helpReturnFocus = this.restorableFocus();
    this.focusContext = "help";
    this.render();
    this.applyFocus();
  }

  private closeHelp(): void {
    if (this.focusContext !== "help") return;
    this.setFocus(this.helpReturnFocus);
  }

  private restorableFocus(): RestorableFocus {
    if (
      this.focusContext === "list" ||
      this.focusContext === "transcript" ||
      this.focusContext === "composer"
    ) {
      return this.focusContext;
    }
    return "list";
  }

  private setFocus(context: RestorableFocus): void {
    let next = context;
    if (!this.snapshot.session.active_thread && next !== "list") next = "list";
    if (!this.layout.showSidebar) {
      this.compactPane = next === "list" ? "list" : "chat";
    }
    this.focusContext = next;
    this.render();
    this.applyFocus();
  }

  private applyFocus(): void {
    switch (this.focusContext) {
      case "list":
        this.refs.threadList.focus();
        break;
      case "transcript":
        this.refs.transcript.focus();
        break;
      case "composer":
        this.refs.composer.focus();
        break;
      case "contact":
        this.focusContactControl();
        break;
      case "help":
        this.refs.helpPanel.focus();
        break;
      case "palette":
        this.refs.paletteSearch.focus();
        break;
    }
  }

  private focusOrder(): RestorableFocus[] {
    if (!this.snapshot.session.active_thread) return ["list"];
    if (this.layout.showSidebar) return ["list", "transcript", "composer"];
    return this.compactPane === "list" ? ["list"] : ["transcript", "composer"];
  }

  private moveFocus(delta: number): void {
    const order = this.focusOrder();
    const current = order.indexOf(this.restorableFocus());
    const next = (Math.max(0, current) + delta + order.length) % order.length;
    const choice = order[next];
    if (choice) this.setFocus(choice);
  }

  private setContactControl(control: ContactControl): void {
    this.contactControl = control;
    this.contactError = "";
    this.renderContactForm();
    this.focusContactControl();
    this.options.renderer.requestRender();
  }

  private focusContactControl(): void {
    switch (this.contactControl) {
      case "alias":
        this.refs.contactAlias.focus();
        break;
      case "number":
        this.refs.contactNumber.focus();
        break;
      case "save":
        this.refs.contactAlias.blur();
        this.refs.contactNumber.blur();
        break;
      case "cancel":
        this.refs.contactAlias.blur();
        this.refs.contactNumber.blur();
        break;
    }
  }

  private moveContactFocus(delta: number): void {
    const order: ContactControl[] = ["alias", "number", "save", "cancel"];
    const current = order.indexOf(this.contactControl);
    const next = (current + delta + order.length) % order.length;
    const choice = order[next];
    if (choice) this.setContactControl(choice);
  }

  private handleKeyPress = (key: KeyEvent): void => {
    if (key.ctrl && key.name === "c") {
      key.preventDefault();
      void this.stop();
      return;
    }
    if (key.ctrl && key.name === "p") {
      key.preventDefault();
      if (this.focusContext === "palette") this.closePalette();
      else if (this.focusContext !== "contact" && this.focusContext !== "help")
        this.openPalette();
      return;
    }

    if (this.focusContext === "palette") {
      if (key.name === "escape") {
        key.preventDefault();
        this.closePalette();
      } else if (key.name === "down") {
        key.preventDefault();
        this.movePaletteSelection(1);
      } else if (key.name === "up") {
        key.preventDefault();
        this.movePaletteSelection(-1);
      } else if (
        key.name === "return" ||
        key.name === "kpenter" ||
        key.name === "linefeed"
      ) {
        key.preventDefault();
        this.runPaletteSelection();
      }
      return;
    }

    if (this.focusContext === "help") {
      if (key.name === "escape" || key.name === "?") {
        key.preventDefault();
        this.closeHelp();
      }
      return;
    }

    if (this.contactFormOpen) {
      if (key.name === "escape") {
        key.preventDefault();
        this.cancelContactForm();
      } else if (key.name === "tab") {
        key.preventDefault();
        this.moveContactFocus(key.shift ? -1 : 1);
      } else if (
        (key.name === "return" || key.name === "kpenter" || key.name === "linefeed") &&
        (this.contactControl === "save" || this.contactControl === "cancel")
      ) {
        key.preventDefault();
        if (this.contactControl === "save") this.submitContact();
        else this.cancelContactForm();
      }
      return;
    }

    if (this.focusContext === "composer") {
      if (key.name === "escape") {
        key.preventDefault();
        this.setFocus("transcript");
      } else if (key.name === "tab") {
        key.preventDefault();
        this.moveFocus(key.shift ? -1 : 1);
      }
      return;
    }

    if (key.name === "tab") {
      key.preventDefault();
      this.moveFocus(key.shift ? -1 : 1);
      return;
    }
    if (key.name === "?") {
      key.preventDefault();
      this.openHelp();
      return;
    }
    if (key.name === "escape") {
      key.preventDefault();
      if (this.focusContext === "transcript") {
        if (this.layout.showSidebar) this.setFocus("list");
        else this.showConversationList();
      }
      return;
    }

    if (this.focusContext === "list") {
      if (key.name === "down" || key.name === "j") {
        key.preventDefault();
        this.moveThread(1);
      } else if (key.name === "up" || key.name === "k") {
        key.preventDefault();
        this.moveThread(-1);
      } else if (
        key.name === "return" ||
        key.name === "kpenter" ||
        key.name === "linefeed"
      ) {
        key.preventDefault();
        this.openSelectedThread();
      } else if (key.name === "a" || key.name === "n") {
        key.preventDefault();
        this.openContactForm();
      } else if (key.name === "c" && this.presentation.connection.canReconnect) {
        key.preventDefault();
        void this.reconnect();
      }
      return;
    }

    if (this.focusContext === "transcript") {
      if (key.name === "down") {
        key.preventDefault();
        this.refs.transcript.scrollBy(1, "step");
      } else if (key.name === "up") {
        key.preventDefault();
        this.refs.transcript.scrollBy(-1, "step");
      } else if (key.name === "pageup" || key.name === "pagedown") {
        key.preventDefault();
        this.refs.transcript.scrollBy(key.name === "pageup" ? -1 : 1, "viewport");
      } else if (key.name === "home") {
        key.preventDefault();
        this.refs.transcript.scrollTo(0);
      } else if (key.name === "end") {
        key.preventDefault();
        this.jumpToLatest();
      } else if (key.name === "i") {
        key.preventDefault();
        this.setFocus("composer");
      } else if (key.name === "c" && this.presentation.connection.canReconnect) {
        key.preventDefault();
        void this.reconnect();
      }
    }
  };

  private handleResize = (): void => {
    const previouslyShowedSidebar = this.layout.showSidebar;
    this.layout = computeBlupostLayout(
      this.options.renderer.terminalWidth,
      this.options.renderer.terminalHeight
    );
    if (previouslyShowedSidebar && !this.layout.showSidebar) {
      this.compactPane = this.focusContext === "list" ? "list" : "chat";
    }
    this.applyLayout();
    this.render();
    this.applyFocus();
  };

  private handleRendererDestroy = (): void => {
    void this.stop();
  };

  private applyLayout(): void {
    this.refs.header.height = this.layout.headerHeight;
    this.refs.header.paddingX = this.layout.horizontalPadding;
    this.refs.brand.width = this.layout.showLargeBrand ? 6 : 4;
    this.refs.brand.height = this.layout.showLargeBrand ? 3 : 2;
    this.refs.footer.height = this.layout.footerHeight;
    this.refs.footer.paddingX = this.layout.horizontalPadding;
    this.refs.sidebar.width = this.layout.showSidebar
      ? this.layout.sidebarWidth
      : "100%";
    this.refs.sidebar.border = this.layout.showSidebar ? ["right"] : false;
    this.refs.listHeader.height = this.layout.tier === "tiny" ? 1 : 2;
    this.refs.listHeader.paddingX = this.layout.horizontalPadding;
    this.refs.threadList.paddingX = 0;
    this.refs.addContactButton.paddingX = this.layout.horizontalPadding;
    this.refs.contactForm.paddingX = this.layout.horizontalPadding;
    this.refs.contactNumberLabel.marginTop = this.layout.tier === "tiny" ? 0 : 1;
    this.refs.contactDisclosure.marginTop = this.layout.tier === "tiny" ? 0 : 1;
    this.refs.contactDisclosure.height = this.layout.tier === "tiny" ? 1 : 2;
    this.refs.chatHeader.height = this.layout.chatHeaderHeight;
    this.refs.chatHeader.border = this.layout.tier === "tiny" ? false : ["bottom"];
    this.refs.chatHeader.paddingX = this.layout.horizontalPadding;
    this.refs.backButton.marginRight = this.layout.tier === "tiny" ? 1 : 2;
    this.refs.transcript.paddingX = this.layout.transcriptPadding;
    this.refs.transcript.paddingY = this.layout.showSidebar ? 1 : 0;
    this.refs.helpPanel.paddingX = this.layout.horizontalPadding;
    this.refs.palettePanel.width =
      this.layout.tier === "compact" || this.layout.tier === "tiny" ? "100%" : "70%";
    this.refs.palettePanel.height =
      this.layout.tier === "tiny"
        ? "100%"
        : Math.min(
            14,
            this.options.renderer.terminalHeight - this.layout.headerHeight - 1
          );
    this.refs.palettePanel.border = this.layout.tier !== "tiny";
    this.refs.composerLabel.visible = this.layout.showComposerLabel;
    this.applyComposerHeight();
  }

  private reportError(error: unknown): void {
    if (this.stopped) return;
    this.setNotice(error instanceof Error ? error.message : String(error), "error");
  }

  private setNotice(message: string, tone: PresentationTone): void {
    this.noticeMessage = message;
    this.noticeTone = tone;
    this.renderFooter();
    this.options.renderer.requestRender();
  }

  private rememberDraft(): void {
    const value = this.refs.composer.plainText;
    if (this.ignoredComposerValue !== undefined) {
      const ignored = this.ignoredComposerValue;
      this.ignoredComposerValue = undefined;
      if (value === ignored) {
        this.applyComposerHeight();
        return;
      }
    }
    this.composerError = "";
    const active = this.snapshot.session.active_thread;
    if (active) {
      void this.options.engine
        .setDraft(active, value)
        .catch(error => this.reportError(error));
    }
    this.renderComposerState();
    this.applyComposerHeight();
    this.renderFooter();
    this.options.renderer.requestRender();
  }

  private async finishSend(
    recipient: string,
    body: string,
    previousLastMessageId: number
  ): Promise<void> {
    try {
      await this.options.engine.sendMessage(recipient, body);
    } catch (error) {
      if (!this.hasAcceptedOutgoing(recipient, body, previousLastMessageId)) {
        await this.restoreRejectedSend(recipient, body);
      }
      this.composerError = error instanceof Error ? error.message : String(error);
    } finally {
      this.sendInFlight = false;
      if (!this.stopped) this.render();
    }
  }

  private hasAcceptedOutgoing(
    recipient: string,
    body: string,
    previousLastMessageId: number
  ): boolean {
    return this.snapshot.session.threads.some(thread =>
      thread.messages.some(
        message =>
          message.id > previousLastMessageId &&
          message.direction === "outgoing" &&
          message.participant === recipient &&
          message.body === body
      )
    );
  }

  private async restoreRejectedSend(recipient: string, body: string): Promise<void> {
    const current =
      this.snapshot.session.active_thread === recipient
        ? this.refs.composer.plainText
        : (this.snapshot.session.threads.find(
            thread => thread.participant === recipient
          )?.draft ?? "");
    const restored = current && current !== body ? `${body}\n${current}` : body;
    if (this.snapshot.session.active_thread === recipient)
      this.setComposerText(restored);
    try {
      await this.options.engine.setDraft(recipient, restored);
    } catch {
      // The visible composer remains recoverable even if draft persistence also fails.
    }
  }

  private changeComposerThread(next: string | null): void {
    const draft = next
      ? (this.snapshot.session.threads.find(thread => thread.participant === next)
          ?.draft ?? "")
      : "";
    this.setComposerText(draft);
  }

  private setComposerText(value: string): void {
    this.ignoredComposerValue = value;
    this.refs.composer.setText(value);
    this.refs.composer.gotoBufferEnd();
    this.applyComposerHeight();
  }

  private async reconnect(): Promise<void> {
    if (this.presentation.connection.isConnecting) return;
    this.noticeMessage = "";
    this.renderFooter();
    try {
      await this.options.engine.connect();
    } catch (error) {
      this.reportError(error);
    }
  }
}

export function createBlupostTui(options: BlupostTuiOptions): BlupostTui {
  return new BlupostTuiApp(options);
}
