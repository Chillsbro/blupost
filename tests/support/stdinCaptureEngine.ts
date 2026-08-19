#!/usr/bin/env bun

export {};

const input = await Bun.stdin.text();
let value: unknown;
try {
  value = JSON.parse(input);
} catch {
  process.exit(1);
}

const valid =
  Bun.argv[2] === "send-stdin" &&
  value !== null &&
  typeof value === "object" &&
  (value as {recipient?: unknown}).recipient === "fixture_alias" &&
  (value as {body?: unknown}).body === "fixture message";
process.exit(valid ? 0 : 1);
