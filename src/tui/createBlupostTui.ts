import {
  BoxRenderable,
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
import {type EngineEvent, emptySnapshot} from "../protocol.js";
import {blupostMarkPng} from "./brandAsset.js";
import {type BlupostLayout, computeBlupostLayout} from "./layout.js";
import {
  type BlupostPresentation,
  createBlupostPresentation,
  type MessagePresentation,
  type PresentationTone
} from "./presentation.js";
import {blupostTheme} from "./theme.js";

type FocusContext = "list" | "transcript" | "composer" | "contact" | "help" | "palette";
type RestorableFocus = Exclude<FocusContext, "contact" | "help" | "palette">;
type CompactPane = "list" | "chat";
type ContactControl = "alias" | "number" | "save" | "cancel";
type PaletteEntry =
  | {kind: "thread"; label: string; description: string; number: string}
  | {kind: "add" | "reconnect" | "help"; label: string; description: string};

interface ViewRefs {
  root: BoxRenderable;
  header: BoxRenderable;
  compactBrand: ImageRenderable;
  compactBrandFallback: TextRenderable;
  connection: TextRenderable;
  compactConnection: TextRenderable;
  notice: TextRenderable;
  main: BoxRenderable;
  sidebar: BoxRenderable;
  sidebarBrandRow: BoxRenderable;
  sidebarBrand: ImageRenderable;
  sidebarBrandFallback: TextRenderable;
  threadList: ScrollBoxRenderable;
  addContactButton: TextRenderable;
  sidebarStatus: BoxRenderable;
  contactView: BoxRenderable;
  contactForm: BoxRenderable;
  contactHeading: TextRenderable;
  contactAlias: TextareaRenderable;
  contactNumberLabel: TextRenderable;
  contactNumber: TextareaRenderable;
  contactDisclosure: TextRenderable;
  contactError: TextRenderable;
  saveContactButton: TextRenderable;
  cancelContactButton: TextRenderable;
  chat: BoxRenderable;
  backButton: TextRenderable;
  conversationTitle: TextRenderable;
  transcript: ScrollBoxRenderable;
  newMessageNotice: TextRenderable;
  composerDock: BoxRenderable;
  composerBox: BoxRenderable;
  composerRow: BoxRenderable;
  composerPrompt: TextRenderable;
  composer: TextareaRenderable;
  sendButton: TextRenderable;
  composerNote: TextRenderable;
  helpPanel: ScrollBoxRenderable;
  paletteOverlay: BoxRenderable;
  palettePanel: BoxRenderable;
  paletteSearch: TextareaRenderable;
  paletteResults: ScrollBoxRenderable;
  helpButton: TextRenderable;
  compactHelpButton: TextRenderable;
}

export interface BlupostTuiOptions {
  renderer: CliRenderer;
  engine: EngineClient;
  autoConnect?: boolean | undefined;
  copyText?: ((text: string) => Promise<"copied" | "terminal-attempted">) | undefined;
}

export interface BlupostTui {
  start(): Promise<void>;
  waitUntilExit(): Promise<void>;
  stop(error?: Error): Promise<void>;
}

function clearChildren(container: BoxRenderable | ScrollBoxRenderable): void {
  for (const child of [...container.getChildren()]) child.destroyRecursively();
}

function toneColor(tone: PresentationTone): string {
  return blupostTheme[tone];
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
  private unsubscribe: (() => void) | undefined;
  private resolveExit: (() => void) | undefined;
  private readonly exitPromise: Promise<void>;
  private exitError: Error | undefined;
  private stopTask: Promise<void> | undefined;
  private stopped = false;
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
    this.presentation = createBlupostPresentation(this.snapshot);
    this.refs = this.buildView();
    options.renderer.root.add(this.refs.root);
    options.renderer.keyInput.on("keypress", this.handleKeyPress);
    options.renderer.on(CliRenderEvents.RESIZE, this.handleResize);
    options.renderer.on(CliRenderEvents.CAPABILITIES, this.handleCapabilities);
    options.renderer.on(CliRenderEvents.DESTROY, this.handleRendererDestroy);
    options.renderer.on(CliRenderEvents.SELECTION, this.handleSelection);
    this.unsubscribe = options.engine.subscribe(this.handleEngineEvent);
    this.applyLayout();
    this.render();
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
    this.options.renderer.keyInput.off("keypress", this.handleKeyPress);
    this.options.renderer.off(CliRenderEvents.RESIZE, this.handleResize);
    this.options.renderer.off(CliRenderEvents.CAPABILITIES, this.handleCapabilities);
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
      height: 1,
      flexDirection: "row",
      paddingX: 1,
      justifyContent: "space-between",
      alignItems: "center",
      backgroundColor: blupostTheme.panel
    });
    const compactBrand = new ImageRenderable(renderer, {
      id: "compact-brand-mark",
      source: blupostMarkPng,
      width: 2,
      height: 1,
      marginRight: 1,
      fit: "fit",
      protocol: "auto"
    });
    const compactBrandFallback = new TextRenderable(renderer, {
      id: "compact-brand-mark-fallback",
      width: 2,
      content: new StyledText([bold(fg(blupostTheme.accent)("b "))]),
      fg: blupostTheme.accent
    });
    const compactConnection = new TextRenderable(renderer, {
      id: "compact-connection-status",
      content: "offline",
      fg: blupostTheme.warning,
      onMouseDown: event => {
        event.preventDefault();
        if (this.presentation.connection.canReconnect) void this.reconnect();
      }
    });
    const compactHelpButton = new TextRenderable(renderer, {
      id: "compact-help-button",
      width: 3,
      content: "  ?",
      fg: blupostTheme.textTertiary,
      onMouseDown: event => {
        event.preventDefault();
        if (this.focusContext === "help") this.closeHelp();
        else if (!this.contactFormOpen && this.focusContext !== "palette")
          this.openHelp();
      }
    });
    const headerActions = new BoxRenderable(renderer, {
      height: 1,
      flexDirection: "row",
      alignItems: "center"
    });
    headerActions.add(compactConnection);

    const notice = new TextRenderable(renderer, {
      id: "notice",
      width: "100%",
      height: 0,
      paddingX: 1,
      content: "",
      fg: blupostTheme.textSecondary,
      bg: blupostTheme.surfaceRaised,
      truncate: true,
      visible: false
    });

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
      backgroundColor: blupostTheme.panel
    });
    const sidebarBrandRow = new BoxRenderable(renderer, {
      id: "sidebar-brand-row",
      width: "100%",
      height: 4,
      border: ["bottom"],
      borderStyle: "single",
      borderColor: blupostTheme.divider,
      flexDirection: "row",
      paddingLeft: 1,
      alignItems: "center",
      backgroundColor: blupostTheme.panel
    });
    const sidebarBrand = new ImageRenderable(renderer, {
      id: "brand-mark",
      source: blupostMarkPng,
      width: 4,
      height: 2,
      fit: "fit",
      protocol: "auto"
    });
    sidebarBrandRow.add(sidebarBrand);
    const sidebarBrandFallback = new TextRenderable(renderer, {
      id: "brand-mark-fallback",
      width: 1,
      content: new StyledText([bold(fg(blupostTheme.accent)("b"))]),
      fg: blupostTheme.accent
    });
    sidebarBrandRow.add(sidebarBrandFallback);
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
      backgroundColor: blupostTheme.panel,
      onMouseDown: () => this.setFocus("list")
    });
    threadList.verticalScrollBar.visible = false;
    threadList.horizontalScrollBar.visible = false;
    const addContactButton = new TextRenderable(renderer, {
      id: "add-contact-button",
      height: 1,
      width: "100%",
      paddingX: 1,
      content: "+ contact",
      fg: blupostTheme.textTertiary,
      bg: blupostTheme.panel,
      onMouseDown: event => {
        event.preventDefault();
        this.openContactForm();
      },
      onMouseOver: () => {
        addContactButton.fg = blupostTheme.signalCyan;
      },
      onMouseOut: () => {
        addContactButton.fg = blupostTheme.textTertiary;
      }
    });
    const sidebarStatus = new BoxRenderable(renderer, {
      id: "sidebar-status",
      height: 1,
      flexGrow: 1,
      paddingRight: 1,
      flexDirection: "row",
      alignSelf: "flex-end",
      justifyContent: "flex-end",
      backgroundColor: blupostTheme.panel
    });
    const connection = new TextRenderable(renderer, {
      id: "connection-status",
      content: "offline",
      fg: blupostTheme.warning,
      onMouseDown: event => {
        event.preventDefault();
        if (this.presentation.connection.canReconnect) void this.reconnect();
      }
    });
    const helpButton = new TextRenderable(renderer, {
      id: "help-button",
      width: 1,
      content: "?",
      fg: blupostTheme.textTertiary,
      onMouseDown: event => {
        event.preventDefault();
        if (this.focusContext === "help") this.closeHelp();
        else if (!this.contactFormOpen && this.focusContext !== "palette")
          this.openHelp();
      }
    });
    sidebarStatus.add(connection);
    sidebarBrandRow.add(sidebarStatus);

    const contactView = new BoxRenderable(renderer, {
      id: "contact-view",
      width: "100%",
      height: "100%",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: blupostTheme.canvas,
      visible: false
    });
    const contactForm = new BoxRenderable(renderer, {
      id: "contact-form",
      width: "100%",
      maxWidth: 48,
      flexDirection: "column",
      paddingX: 2,
      paddingY: 1,
      border: true,
      borderStyle: "single",
      borderColor: blupostTheme.divider,
      backgroundColor: blupostTheme.surfaceRaised
    });
    const contactHeading = new TextRenderable(renderer, {
      height: 1,
      content: new StyledText([bold(fg(blupostTheme.textPrimary)("New contact"))]),
      fg: blupostTheme.textPrimary,
      marginBottom: 1
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
      backgroundColor: blupostTheme.canvas,
      focusedBackgroundColor: blupostTheme.selectionFocus,
      cursorColor: blupostTheme.signalBright,
      paddingLeft: 1,
      placeholder: "Alice",
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
      backgroundColor: blupostTheme.canvas,
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
      height: 1,
      width: "100%",
      marginTop: 1,
      content: "Stored locally.",
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
      width: 8,
      content: " Save ",
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
      bg: blupostTheme.surfaceRaised,
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
    sidebar.add(sidebarBrandRow);
    sidebar.add(threadList);
    sidebar.add(addContactButton);
    contactView.add(contactForm);

    const chat = new BoxRenderable(renderer, {
      id: "conversation-detail",
      height: "100%",
      flexGrow: 1,
      flexDirection: "column"
    });
    const backButton = new TextRenderable(renderer, {
      id: "back-button",
      content: "‹",
      fg: blupostTheme.cyan,
      marginRight: 1,
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
    header.add(compactBrand);
    header.add(compactBrandFallback);
    header.add(backButton);
    header.add(conversationTitle);
    header.add(headerActions);

    const transcript = new ScrollBoxRenderable(renderer, {
      id: "transcript",
      width: "100%",
      flexGrow: 1,
      paddingX: 1,
      paddingY: 0,
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
      bg: blupostTheme.canvas,
      visible: false,
      onMouseDown: event => {
        event.preventDefault();
        this.jumpToLatest();
      }
    });
    const composerDock = new BoxRenderable(renderer, {
      id: "composer-dock",
      width: "100%",
      height: 3,
      flexDirection: "column",
      paddingX: 1,
      backgroundColor: blupostTheme.canvas
    });
    const composerBox = new BoxRenderable(renderer, {
      id: "composer-region",
      height: 3,
      flexDirection: "column",
      border: true,
      borderStyle: "single",
      borderColor: blupostTheme.borderSoft,
      backgroundColor: blupostTheme.panel
    });
    const composerRow = new BoxRenderable(renderer, {
      height: 1,
      flexDirection: "row",
      alignItems: "center",
      paddingLeft: 1
    });
    const composerPrompt = new TextRenderable(renderer, {
      id: "composer-prompt",
      width: 0,
      content: "",
      fg: blupostTheme.signalCyan
    });
    const composer = new TextareaRenderable(renderer, {
      id: "composer",
      flexGrow: 1,
      height: "100%",
      textColor: blupostTheme.text,
      focusedTextColor: blupostTheme.text,
      placeholder: "Write a message",
      placeholderColor: blupostTheme.faint,
      backgroundColor: blupostTheme.panel,
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
      content: " ↑ ",
      fg: blupostTheme.inverseText,
      bg: blupostTheme.accent,
      width: 3,
      visible: true,
      onMouseDown: event => {
        event.preventDefault();
        this.submitMessage();
      },
      onMouseOver: () => {
        if (this.presentation.connection.isConnected)
          sendButton.bg = blupostTheme.signalBright;
      },
      onMouseOut: () => {
        sendButton.bg = this.presentation.connection.isConnected
          ? blupostTheme.accent
          : blupostTheme.surfaceRaised;
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
    composerRow.add(composerPrompt);
    composerRow.add(composer);
    composerRow.add(sendButton);
    composerBox.add(composerRow);
    composerBox.add(composerNote);
    composerDock.add(composerBox);
    chat.add(transcript);
    chat.add(newMessageNotice);
    chat.add(composerDock);

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
      width: "100%",
      height: 11,
      maxWidth: 52,
      flexDirection: "column",
      paddingX: 1,
      paddingY: 1,
      border: true,
      borderStyle: "single",
      borderColor: blupostTheme.divider,
      backgroundColor: blupostTheme.surfaceRaised
    });
    const paletteSearch = new TextareaRenderable(renderer, {
      id: "command-palette-search",
      width: "100%",
      height: 1,
      textColor: blupostTheme.textPrimary,
      focusedTextColor: blupostTheme.textPrimary,
      placeholder: "Search",
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
    main.add(contactView);
    main.add(helpPanel);
    main.add(paletteOverlay);
    root.add(header);
    root.add(notice);
    root.add(main);

    return {
      root,
      header,
      compactBrand,
      compactBrandFallback,
      connection,
      compactConnection,
      notice,
      main,
      sidebar,
      sidebarBrandRow,
      sidebarBrand,
      sidebarBrandFallback,
      threadList,
      addContactButton,
      sidebarStatus,
      contactView,
      contactForm,
      contactHeading,
      contactAlias,
      contactNumberLabel,
      contactNumber,
      contactDisclosure,
      contactError,
      saveContactButton,
      cancelContactButton,
      chat,
      backButton,
      conversationTitle,
      transcript,
      newMessageNotice,
      composerDock,
      composerBox,
      composerRow,
      composerPrompt,
      composer,
      sendButton,
      composerNote,
      helpPanel,
      paletteOverlay,
      palettePanel,
      paletteSearch,
      paletteResults,
      helpButton,
      compactHelpButton
    };
  }

  private handleEngineEvent = (event: EngineEvent): void => {
    if (event.type === "snapshot") {
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
      const firstSnapshot = !this.hasReceivedSnapshot;
      this.hasReceivedSnapshot = true;
      this.snapshot = event.snapshot;
      this.presentation = createBlupostPresentation(this.snapshot);

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

      this.render();
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
    this.presentation = createBlupostPresentation(this.snapshot);
    this.renderConnection();
    this.renderThreads();
    this.renderConversation();
    this.renderNewMessageNotice();
    this.renderContactForm();
    this.renderHelp();
    this.renderPalette();
    this.renderVisibility();
    this.renderNotice();
    this.applyComposerHeight();
    this.options.renderer.requestRender();
  }

  private renderConnection(): void {
    const {connection} = this.presentation;
    const stateColor = connection.isConnected
      ? blupostTheme.accent
      : toneColor(connection.tone);
    const stateGlyph = connection.isConnected
      ? "●"
      : connection.isConnecting
        ? "◌"
        : connection.canReconnect
          ? "○"
          : "·";
    for (const target of [this.refs.connection, this.refs.compactConnection]) {
      target.content = new StyledText([
        fg(stateColor)(`${stateGlyph} `),
        fg(blupostTheme.textSecondary)(connection.label)
      ]);
      target.fg = blupostTheme.textSecondary;
      target.bg = blupostTheme.panel;
    }
    const helpColor =
      this.focusContext === "help"
        ? blupostTheme.signalCyan
        : blupostTheme.textTertiary;
    this.refs.helpButton.fg = helpColor;
    this.refs.compactHelpButton.fg = helpColor;
  }

  private renderThreads(): void {
    clearChildren(this.refs.threadList);
    const focused = this.focusContext === "list";

    if (this.presentation.conversations.length === 0) {
      this.refs.threadList.add(
        new TextRenderable(this.options.renderer, {
          content: "No contacts.",
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
      const rowBackground =
        selected && focused
          ? blupostTheme.selectionFocus
          : active
            ? blupostTheme.selectionIdle
            : blupostTheme.panel;
      const showPreview = this.layout.showConversationPreviews;
      const row = new BoxRenderable(this.options.renderer, {
        id: `thread-row-${index}`,
        width: "100%",
        height: showPreview ? 2 : 1,
        flexDirection: "column",
        backgroundColor: rowBackground,
        onMouseDown: event => {
          event.preventDefault();
          this.selectedThread = conversation.number;
          this.openThread(conversation.number);
        },
        onMouseOver: () => {
          if (!active && !(selected && focused))
            row.backgroundColor = blupostTheme.surfaceHover;
        },
        onMouseOut: () => {
          row.backgroundColor = rowBackground;
        }
      });
      const topLine = new BoxRenderable(this.options.renderer, {
        width: "100%",
        height: 1,
        flexDirection: "row",
        justifyContent: "space-between",
        paddingX: this.layout.horizontalPadding
      });
      const marker = selected && focused ? "›" : active ? "▌" : selected ? "·" : " ";
      const label = new TextRenderable(this.options.renderer, {
        flexGrow: 1,
        content: new StyledText([
          fg(
            active || (selected && focused)
              ? blupostTheme.accent
              : blupostTheme.textTertiary
          )(`${marker} `),
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
          ? "draft"
          : "";
      const metadata = new TextRenderable(this.options.renderer, {
        content: conversation.unread ? ` ${priority} ` : priority ? ` ${priority}` : "",
        fg: conversation.unread ? blupostTheme.inverseText : blupostTheme.textTertiary,
        bg: conversation.unread ? blupostTheme.accent : rowBackground
      });
      topLine.add(label);
      topLine.add(metadata);
      row.add(topLine);
      if (showPreview) {
        row.add(
          new TextRenderable(this.options.renderer, {
            id: `thread-preview-${index}`,
            paddingRight: 1,
            content:
              conversation.preview || conversation.draft
                ? `   ${conversation.preview || conversation.draft}`
                : "",
            fg: blupostTheme.textSecondary,
            truncate: true
          })
        );
      }
      this.refs.threadList.add(row);
    }
  }

  private renderConversation(): void {
    clearChildren(this.refs.transcript);
    const active = this.presentation.activeConversation;
    const compactChat =
      !this.layout.showSidebar && this.compactPane === "chat" && Boolean(active);
    this.refs.backButton.visible = compactChat;
    this.refs.backButton.content = "‹";
    const conversationLabel = compactChat ? (active?.label ?? "") : "contacts";
    const conversationFocused =
      this.focusContext === "transcript" || this.focusContext === "composer";
    const title = bold(
      fg(conversationFocused ? blupostTheme.signalBright : blupostTheme.textPrimary)(
        conversationLabel
      )
    );
    this.refs.conversationTitle.content = new StyledText([
      this.focusContext === "transcript" ? underline(title) : title
    ]);

    if (!active) {
      this.refs.composerDock.visible = false;
      this.refs.composerBox.visible = false;
      return;
    }

    this.refs.composerDock.visible = true;
    this.refs.composerBox.visible = true;
    if (active.groups.length === 0) {
      this.refs.transcript.add(
        new TextRenderable(this.options.renderer, {
          content: "No messages yet.",
          fg: blupostTheme.text,
          wrapMode: "word"
        })
      );
    } else {
      this.refs.transcript.add(
        new BoxRenderable(this.options.renderer, {
          id: "transcript-spacer",
          width: "100%",
          flexGrow: 1
        })
      );
      const latestOutgoing = active.groups
        .flatMap(group => group.messages)
        .filter(message => message.state !== "received")
        .at(-1)?.id;
      for (const group of active.groups) {
        const outgoing = group.direction === "outgoing";
        const groupView = new BoxRenderable(this.options.renderer, {
          width: "100%",
          flexDirection: "column",
          alignItems: outgoing ? "flex-end" : "flex-start",
          marginBottom: 1
        });
        for (const message of group.messages) {
          groupView.add(
            this.messageView(message, outgoing, message.id === latestOutgoing)
          );
        }
        this.refs.transcript.add(groupView);
      }
    }
    this.renderComposerState();
  }

  private messageView(
    message: MessagePresentation,
    outgoing: boolean,
    showSent: boolean
  ): BoxRenderable {
    const box = new BoxRenderable(this.options.renderer, {
      flexDirection: "column",
      alignItems: outgoing ? "flex-end" : "flex-start",
      marginBottom: 0,
      maxWidth:
        this.layout.tier === "roomy"
          ? "70%"
          : this.layout.tier === "standard"
            ? "78%"
            : this.layout.tier === "compact"
              ? "90%"
              : "100%"
    });
    const surface = new BoxRenderable(this.options.renderer, {
      id: `message-surface-${message.id}`,
      maxWidth: "100%",
      paddingX: 1,
      backgroundColor: outgoing
        ? blupostTheme.outgoingSurface
        : blupostTheme.surfaceRaised
    });
    surface.add(
      new TextRenderable(this.options.renderer, {
        id: `message-body-${message.id}`,
        content: linkifyMessage(message.body),
        fg: blupostTheme.textPrimary,
        bg: outgoing ? blupostTheme.outgoingSurface : blupostTheme.surfaceRaised,
        selectionBg: blupostTheme.accent,
        selectionFg: blupostTheme.inverseText,
        wrapMode: "word"
      })
    );
    box.add(surface);
    if (message.outcome && (message.state !== "sent" || showSent)) {
      const outcome = new TextRenderable(this.options.renderer, {
        id: `message-outcome-${message.id}`,
        content: message.outcome,
        fg:
          message.state === "sending"
            ? blupostTheme.signalCyan
            : toneColor(message.outcomeTone),
        bg: blupostTheme.canvas,
        wrapMode: "word"
      });
      box.add(outcome);
    }
    return box;
  }

  private renderComposerState(): void {
    const active = this.presentation.activeConversation;
    if (!active) return;
    const hasDraft = Boolean(this.refs.composer.plainText.trim());
    this.refs.composer.placeholder = "Write a message";
    this.refs.sendButton.content = this.sendInFlight ? " … " : " ↑ ";
    this.refs.sendButton.width = 3;
    this.refs.sendButton.visible = true;
    this.refs.sendButton.fg = this.presentation.connection.isConnected
      ? blupostTheme.inverseText
      : blupostTheme.textTertiary;
    this.refs.sendButton.bg = this.presentation.connection.isConnected
      ? blupostTheme.accent
      : blupostTheme.surfaceRaised;
    if (this.layout.frameComposer) {
      this.refs.composerBox.borderColor =
        this.focusContext === "composer"
          ? blupostTheme.signalBright
          : blupostTheme.divider;
      this.refs.composerBox.border = true;
    } else {
      this.refs.composerBox.border = false;
    }
    this.refs.composerPrompt.content = "";
    this.refs.composerPrompt.width = 0;

    const connectionNote =
      this.presentation.connection.isConnected || !hasDraft
        ? ""
        : this.presentation.connection.isConnecting
          ? "Connecting — draft only; nothing will queue."
          : "Offline — draft only; nothing will queue.";
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
    this.refs.newMessageNotice.content = visible ? `↓ ${this.newMessageCount} new` : "";
    this.refs.newMessageNotice.fg = blupostTheme.signalCyan;
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
    this.refs.contactHeading.visible = this.layout.showSidebar;
    this.refs.contactHeading.height = this.layout.showSidebar ? 1 : 0;
    this.refs.contactHeading.marginBottom = this.layout.showSidebar ? 1 : 0;
    this.refs.contactError.visible = Boolean(this.contactError);
    this.refs.contactError.height = this.contactError ? 2 : 0;
    this.refs.contactError.content = this.contactError;
    this.refs.contactDisclosure.content = "Stored locally.";
    this.refs.saveContactButton.content = this.contactSaveInFlight
      ? " saving… "
      : this.contactControl === "save"
        ? "› save "
        : " save ";
    this.refs.saveContactButton.width = this.contactSaveInFlight ? 10 : 8;
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
      this.contactControl === "cancel" ? "› cancel " : " cancel ";
    this.refs.cancelContactButton.bg =
      this.contactControl === "cancel"
        ? blupostTheme.selectionFocus
        : blupostTheme.surfaceRaised;
  }

  private renderHelp(): void {
    clearChildren(this.refs.helpPanel);
    if (this.focusContext !== "help") return;
    if (this.layout.showSidebar) {
      this.refs.helpPanel.add(
        new TextRenderable(this.options.renderer, {
          content: new StyledText([bold(fg(blupostTheme.textPrimary)("Help"))]),
          fg: blupostTheme.textPrimary,
          marginBottom: 1
        })
      );
    }
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
        ? `↑/↓ or j/k  select
Enter       open
n           new contact`
        : this.helpReturnFocus === "transcript"
          ? `↑/↓        scroll
Home/End   oldest/latest
i          write`
          : `Enter       send
Shift+Enter new line
Esc         transcript`;
    return `${contextHelp}

Tab         next area
Esc         back
Ctrl+P      search and actions
?           help
Ctrl+C      quit

Messages and drafts last only while Blupost is open. Offline sends are never queued or retried.`;
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
    const fullWidthPanel =
      this.layout.tier === "compact" || this.layout.tier === "tiny";
    const panelWidth = Math.min(
      52,
      fullWidthPanel
        ? this.options.renderer.terminalWidth
        : Math.ceil(this.options.renderer.terminalWidth * 0.55)
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
        height: 1,
        flexDirection: "row",
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
          content: `${selected ? "›" : " "} ${entry.label}`,
          fg: selected ? blupostTheme.textPrimary : blupostTheme.textSecondary,
          truncate: true,
          onMouseDown: event => {
            event.preventDefault();
            activate();
          }
        })
      );
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
    const setCompactTitle = (title: string): void => {
      if (this.layout.showSidebar) return;
      this.refs.backButton.visible = false;
      this.refs.conversationTitle.content = new StyledText([
        bold(fg(blupostTheme.textPrimary)(title))
      ]);
    };
    const paletteOpen = this.focusContext === "palette";
    this.refs.paletteOverlay.visible = paletteOpen;
    this.refs.contactView.visible = false;
    if (paletteOpen) {
      setCompactTitle("Actions");
      this.refs.helpPanel.visible = false;
      this.refs.sidebar.visible = false;
      this.refs.chat.visible = false;
      return;
    }
    if (this.contactFormOpen) {
      setCompactTitle("New contact");
      this.refs.contactView.visible = true;
      this.refs.helpPanel.visible = false;
      this.refs.sidebar.visible = false;
      this.refs.chat.visible = false;
      return;
    }
    const helpOpen = this.focusContext === "help";
    this.refs.helpPanel.visible = helpOpen;
    if (helpOpen) {
      setCompactTitle("Help");
      this.refs.sidebar.visible = false;
      this.refs.chat.visible = false;
      return;
    }

    if (this.layout.showSidebar) {
      this.refs.sidebar.visible = true;
      this.refs.chat.visible = true;
      return;
    }

    const showList = this.compactPane === "list";
    this.refs.sidebar.visible = showList;
    this.refs.chat.visible = !showList;
  }

  private renderNotice(): void {
    const visible = Boolean(this.noticeMessage);
    this.refs.notice.visible = visible;
    this.refs.notice.height = visible ? 1 : 0;
    this.refs.notice.content = this.noticeMessage;
    this.refs.notice.fg = toneColor(this.noticeTone);
  }

  private applyComposerHeight(): void {
    if (!this.refs.composerDock.visible) return;
    const text = this.refs.composer.plainText;
    const detailWidth = this.layout.showSidebar
      ? this.options.renderer.terminalWidth - this.layout.sidebarWidth
      : this.options.renderer.terminalWidth;
    const buttonWidth = this.refs.sendButton.visible ? this.refs.sendButton.width : 0;
    const inputWidth = Math.max(12, detailWidth - buttonWidth - 5);
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
    const borderRows = this.layout.frameComposer ? 2 : 0;
    this.refs.composerRow.height = contentRows;
    this.refs.composer.height = contentRows;
    this.refs.composerNote.height = noteRows;
    this.refs.composerBox.height = borderRows + contentRows + noteRows;
    this.refs.composerDock.height = borderRows + contentRows + noteRows;
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
    this.renderNotice();
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

  private handleCapabilities = (): void => {
    this.syncBrandRendering();
    this.options.renderer.requestRender();
  };

  private handleRendererDestroy = (): void => {
    void this.stop();
  };

  private applyLayout(): void {
    this.refs.header.visible = !this.layout.showSidebar;
    this.refs.header.height = this.layout.showSidebar
      ? 0
      : this.layout.compactHeaderHeight;
    this.refs.header.paddingX = this.layout.horizontalPadding;
    this.refs.sidebarBrandRow.visible = this.layout.showSidebar;
    this.refs.sidebarBrandRow.height = this.layout.showSidebar ? 4 : 0;
    this.refs.sidebarStatus.visible = this.layout.showSidebar;
    this.refs.sidebar.width = this.layout.showSidebar
      ? this.layout.sidebarWidth
      : "100%";
    this.refs.sidebar.border = this.layout.showSidebar ? ["right"] : false;
    this.refs.threadList.paddingX = 0;
    this.refs.addContactButton.paddingX = this.layout.horizontalPadding;
    this.refs.contactForm.paddingX = this.layout.horizontalPadding;
    this.refs.contactForm.border = this.layout.tier !== "tiny";
    this.refs.contactNumberLabel.marginTop = this.layout.tier === "tiny" ? 0 : 1;
    this.refs.contactDisclosure.marginTop = this.layout.tier === "tiny" ? 0 : 1;
    this.refs.contactDisclosure.height = 1;
    this.refs.backButton.marginRight = 1;
    this.refs.transcript.paddingX = this.layout.transcriptPadding;
    this.refs.transcript.paddingY = this.layout.showSidebar ? 1 : 0;
    this.refs.composerDock.paddingX = this.layout.frameComposer ? 1 : 0;
    this.refs.composerBox.border = this.layout.frameComposer;
    this.refs.helpPanel.paddingX = this.layout.horizontalPadding;
    this.refs.palettePanel.width = "100%";
    this.refs.palettePanel.height =
      this.layout.tier === "tiny"
        ? "100%"
        : Math.min(
            11,
            this.options.renderer.terminalHeight -
              (this.layout.showSidebar ? 0 : this.layout.compactHeaderHeight)
          );
    this.refs.palettePanel.border = this.layout.tier !== "tiny";
    this.syncBrandRendering();
    this.applyComposerHeight();
  }

  private syncBrandRendering(): void {
    const sidebarUsesImage = this.refs.sidebarBrand.effectiveProtocol !== "blocks";
    const compactUsesImage = this.refs.compactBrand.effectiveProtocol !== "blocks";
    this.refs.sidebarBrand.visible = this.layout.showSidebar && sidebarUsesImage;
    this.refs.sidebarBrandFallback.visible =
      this.layout.showSidebar && !sidebarUsesImage;
    this.refs.compactBrand.visible = !this.layout.showSidebar && compactUsesImage;
    this.refs.compactBrandFallback.visible =
      !this.layout.showSidebar && !compactUsesImage;
  }

  private reportError(error: unknown): void {
    if (this.stopped) return;
    this.setNotice(error instanceof Error ? error.message : String(error), "error");
  }

  private setNotice(message: string, tone: PresentationTone): void {
    this.noticeMessage = message;
    this.noticeTone = tone;
    this.renderNotice();
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
    this.renderNotice();
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
    this.renderNotice();
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
