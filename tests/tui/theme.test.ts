import {expect, test} from "bun:test";
import {blupostTheme} from "../../src/tui/theme.js";

test("locks the approved electric-blue and dark-grey visual system", () => {
  expect(blupostTheme).toMatchObject({
    accent: "#168bff",
    canvas: "#0b0e12",
    panel: "#151a21",
    surfaceRaised: "#1c232c",
    selectionFocus: "#153352",
    outgoingSurface: "#103a61",
    divider: "#2a323c",
    textPrimary: "#e8edf3",
    textSecondary: "#7f8b99"
  });
});
