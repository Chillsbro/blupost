import {expect, test} from "bun:test";

const preview = await Bun.file(
  new URL("../../docs/ui-preview.svg", import.meta.url)
).text();

test("the README preview is an implemented deterministic Electric Quiet frame", () => {
  expect(preview).toContain("Blupost Electric Quiet at 120x34");
  expect(preview).toContain("authentic deterministic frame");
  expect(preview).toContain("● Connected · Nearby iPhone");
  expect(preview).toContain("＋ Add contact");
  expect(preview).toContain("? Check your phone — outcome unknown");
  expect(preview).toContain("#061014");
  expect(preview).toContain("#65a9ff");
  expect(preview).not.toMatch(/\+\d{7,}/u);
});
