import {expect, test} from "bun:test";
import {computeBlupostLayout} from "../../src/tui/layout.js";

test.each([
  [120, 34, "roomy", true, true, 5],
  [90, 24, "standard", true, true, 4],
  [72, 20, "standard", true, false, 3],
  [60, 18, "compact", false, false, 3],
  [48, 14, "compact", false, false, 2],
  [40, 12, "tiny", false, false, 1]
] as const)("%ix%i derives the %s capability tier", (width, height, tier, showSidebar, showPreview, composerMaxRows) => {
  const layout = computeBlupostLayout(width, height);

  expect(layout.tier).toBe(tier);
  expect(layout.showSidebar).toBe(showSidebar);
  expect(layout.showThreadPreview).toBe(showPreview);
  expect(layout.composerMaxRows).toBe(composerMaxRows);
  expect(layout.sidebarWidth).toBeGreaterThanOrEqual(22);
  expect(layout.sidebarWidth).toBeLessThanOrEqual(34);
});

test("tiny viewports keep only essential chrome", () => {
  const layout = computeBlupostLayout(40, 12);

  expect(layout.showPhoneName).toBe(false);
  expect(layout.showSecondaryHints).toBe(false);
  expect(layout.showSessionCount).toBe(false);
  expect(layout.headerHeight).toBe(2);
  expect(layout.footerHeight).toBe(1);
  expect(layout.showLargeBrand).toBe(false);
  expect(layout.showComposerLabel).toBe(true);
});
