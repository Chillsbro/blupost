import {expect, test} from "bun:test";
import {computeBlupostLayout} from "../../src/tui/layout.js";

test.each([
  [120, 34, "roomy", true, 4],
  [90, 24, "standard", true, 3],
  [72, 20, "standard", true, 3],
  [60, 18, "compact", false, 3],
  [48, 14, "compact", false, 2],
  [40, 12, "tiny", false, 2]
] as const)("%ix%i derives the %s capability tier", (width, height, tier, showSidebar, composerMaxRows) => {
  const layout = computeBlupostLayout(width, height);

  expect(layout.tier).toBe(tier);
  expect(layout.showSidebar).toBe(showSidebar);
  expect(layout.showConversationPreviews).toBe(tier !== "tiny");
  expect(layout.frameComposer).toBe(tier !== "tiny");
  expect(layout.composerMaxRows).toBe(composerMaxRows);
  expect(layout.sidebarWidth).toBeGreaterThanOrEqual(21);
  expect(layout.sidebarWidth).toBeLessThanOrEqual(30);
});

test("tiny viewports reserve one context row and one quiet composer", () => {
  const layout = computeBlupostLayout(40, 12);

  expect(layout.showSidebar).toBe(false);
  expect(layout.compactHeaderHeight).toBe(1);
  expect(layout.horizontalPadding).toBe(1);
  expect(layout.transcriptPadding).toBe(1);
  expect(layout.showConversationPreviews).toBe(false);
  expect(layout.frameComposer).toBe(false);
});
