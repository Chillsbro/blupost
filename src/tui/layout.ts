export type BlupostLayoutTier = "roomy" | "standard" | "compact" | "tiny";

export interface BlupostLayout {
  tier: BlupostLayoutTier;
  showSidebar: boolean;
  showThreadPreview: boolean;
  showSecondaryHints: boolean;
  showSessionCount: boolean;
  showPhoneName: boolean;
  showComposerLabel: boolean;
  showLargeBrand: boolean;
  sidebarWidth: number;
  headerHeight: number;
  chatHeaderHeight: number;
  composerMaxRows: number;
  footerHeight: number;
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
  if (tier === "tiny") return 1;
  if (height < 16) return 2;
  if (tier === "roomy") return 5;
  if (height >= 22) return 4;
  return 3;
}

/**
 * Converts raw terminal dimensions into the named capabilities the renderer uses.
 * Callers never need to know the breakpoint arithmetic.
 */
export function computeBlupostLayout(width: number, height: number): BlupostLayout {
  const tier = tierFor(width, height);
  const showSidebar = tier === "roomy" || tier === "standard";
  const roomySidebar = Math.min(34, Math.max(30, Math.floor(width * 0.29)));
  const standardSidebar = Math.min(28, Math.max(24, Math.floor(width * 0.3)));

  return {
    tier,
    showSidebar,
    showThreadPreview: tier === "roomy" || (tier === "standard" && height >= 22),
    showSecondaryHints: tier === "roomy" || tier === "standard",
    showSessionCount: tier === "roomy",
    showPhoneName: tier === "roomy",
    showComposerLabel: true,
    showLargeBrand: tier === "roomy" || tier === "standard",
    sidebarWidth: tier === "roomy" ? roomySidebar : standardSidebar,
    headerHeight: tier === "roomy" || tier === "standard" ? 3 : 2,
    chatHeaderHeight:
      tier === "roomy" || tier === "standard" ? 3 : tier === "tiny" ? 1 : 2,
    composerMaxRows: composerRowsFor(tier, height),
    footerHeight: 1,
    horizontalPadding: tier === "tiny" ? 1 : 2,
    transcriptPadding: tier === "roomy" ? 3 : tier === "tiny" ? 1 : 2
  };
}
