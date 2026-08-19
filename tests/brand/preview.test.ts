import {expect, test} from "bun:test";

const preview = await Bun.file(
  new URL("../../docs/brand/preview.html", import.meta.url)
).text();

test("the hero embeds a lowercase b with a speech tail trailing from its bowl", () => {
  const logo = preview.match(/<svg id="hero-logo"[\s\S]*?<\/svg>/)?.[0];
  const mark = preview.match(/<symbol id="blupost-mark"[\s\S]*?<\/symbol>/)?.[0];

  expect(logo).toBeDefined();
  expect(logo).toContain('href="#blupost-mark"');
  expect(mark).toContain('data-logo-part="bubble-b"');
  expect(mark).toContain('data-logo-part="trailing-tail"');
  expect(mark).toContain('data-tail-side="lower-left"');
  expect(mark).toContain('mask="url(#blupost-counter-mask)"');
  expect(preview).toContain('data-logo-part="letter-counter"');
  expect(mark).not.toContain('data-logo-part="lowercase-b"');
  expect(preview).not.toContain('data-logo-part="bubble-counter"');
  expect(preview).not.toContain("lower-right tail");
  expect(mark).not.toContain("<text");
  expect(preview).not.toContain('<img id="hero-motion"');
});
