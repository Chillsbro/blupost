import type {BlupostLayoutTier} from "./layout.js";

export type VisualContext =
  | "list"
  | "transcript"
  | "composer"
  | "contact"
  | "help"
  | "palette";
export type ModeTone = "neutral" | "signal" | "post";

export interface ActionRibbon {
  key: string;
  label: string;
}

export interface BlupostChrome {
  modeLabel: "INBOX" | "READ" | "WRITE" | "CONTACT" | "HELP" | "COMMAND";
  modeTone: ModeTone;
  actions: ActionRibbon[];
}

const roomyActions: Record<VisualContext, readonly ActionRibbon[]> = {
  list: [
    {key: "↑↓", label: "Move"},
    {key: "↵", label: "Open"},
    {key: "N", label: "Contact"}
  ],
  transcript: [
    {key: "↑↓", label: "Read"},
    {key: "End", label: "Latest"},
    {key: "I", label: "Write"}
  ],
  composer: [
    {key: "↵", label: "Send"},
    {key: "⇧↵", label: "New line"},
    {key: "Esc", label: "Read"}
  ],
  contact: [
    {key: "Tab", label: "Next"},
    {key: "↵", label: "Choose"},
    {key: "Esc", label: "Cancel"}
  ],
  help: [
    {key: "↑↓", label: "Read"},
    {key: "Esc", label: "Close"}
  ],
  palette: [
    {key: "↑↓", label: "Move"},
    {key: "↵", label: "Open"},
    {key: "Esc", label: "Close"}
  ]
};

const contextMode: Record<
  VisualContext,
  Pick<BlupostChrome, "modeLabel" | "modeTone">
> = {
  list: {modeLabel: "INBOX", modeTone: "post"},
  transcript: {modeLabel: "READ", modeTone: "post"},
  composer: {modeLabel: "WRITE", modeTone: "signal"},
  contact: {modeLabel: "CONTACT", modeTone: "post"},
  help: {modeLabel: "HELP", modeTone: "neutral"},
  palette: {modeLabel: "COMMAND", modeTone: "signal"}
};

function actionLimit(tier: BlupostLayoutTier): number {
  if (tier === "tiny") return 1;
  if (tier === "compact") return 2;
  return 3;
}

/**
 * Produces the complete persistent chrome for one focus context. The renderer
 * only styles these ribbons; it does not need to know shortcut priority rules.
 */
export function createBlupostChrome(
  context: VisualContext,
  tier: BlupostLayoutTier,
  canReconnect: boolean
): BlupostChrome {
  const actions = [...roomyActions[context]];
  if (
    canReconnect &&
    (context === "list" || context === "transcript") &&
    tier !== "tiny"
  ) {
    actions[actions.length - 1] = {key: "C", label: "Connect"};
  }
  return {
    ...contextMode[context],
    actions: actions.slice(0, actionLimit(tier))
  };
}
