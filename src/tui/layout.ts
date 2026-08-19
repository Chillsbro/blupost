export type BlupostLayoutTier = "roomy" | "standard" | "compact" | "tiny";

export interface BlupostLayout {
  tier: BlupostLayoutTier;
  showSidebar: boolean;
  showConversationPreviews: boolean;
  frameComposer: boolean;
  sidebarWidth: number;
  compactHeaderHeight: number;
  composerMaxRows: number;
  horizontalPadding: number;
  transcriptPadding: number;
}

function tierFor(width: number, height: number): BlupostLayoutTier {
  if (width < 48 || height < 14) return "tiny";
  if (width < 72 || height < 18) return "compact";
  if (width >= 100 && height >= 24) return "roomy";
  return "standard";
}

function composerRowsFor(tier: BlupostLayoutTier, height: number): number {
  if (tier === "tiny") return 2;
  if (height < 16) return 2;
  if (tier === "roomy") return 4;
  return 3;
}

/**
 * Converts raw terminal dimensions into the named capabilities the renderer uses.
 * Callers never need to know the breakpoint arithmetic.
 */
export function computeBlupostLayout(width: number, height: number): BlupostLayout {
  const tier = tierFor(width, height);
  const showSidebar = tier === "roomy" || tier === "standard";
  const roomySidebar = Math.min(30, Math.max(26, Math.floor(width * 0.24)));
  const standardSidebar = Math.min(24, Math.max(21, Math.floor(width * 0.28)));

  return {
    tier,
    showSidebar,
    showConversationPreviews: tier !== "tiny",
    frameComposer: tier !== "tiny",
    sidebarWidth: tier === "roomy" ? roomySidebar : standardSidebar,
    compactHeaderHeight: 1,
    composerMaxRows: composerRowsFor(tier, height),
    horizontalPadding: 1,
    transcriptPadding: tier === "roomy" ? 2 : 1
  };
}
