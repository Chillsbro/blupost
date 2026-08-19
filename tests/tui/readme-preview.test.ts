import {expect, test} from "bun:test";

const preview = await Bun.file(
  new URL("../../docs/ui-preview.svg", import.meta.url)
).text();

test("the README preview is the implemented electric-blue frame", () => {
  expect(preview).toContain("Electric-blue Blupost messaging interface at 120x34");
  expect(preview).toContain("authentic deterministic frame");
  expect(preview).toContain("alice");
  expect(preview).toContain("+ contact");
  expect(preview).toContain("connected");
  expect(preview).toContain("Write a message");
  expect(preview).toContain("data:image/png;base64,");
  expect(preview).toContain("Geist Mono");
  expect(preview).toContain("#0b0e12");
  expect(preview).toContain("#151a21");
  expect(preview).toContain("#168bff");
  expect(preview).not.toContain("Nearby iPhone");
  expect(preview).not.toContain("TO ");
  expect(preview).not.toContain("Message alice");
  expect(preview).not.toContain("SESSION");
  expect(preview).not.toMatch(/\+\d{7,}/u);
});
