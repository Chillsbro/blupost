import {expect, test} from "bun:test";
import {resolve} from "node:path";
import {prepareEngineInvocation} from "../../src/engine/prepareEngineInvocation.js";

test("forwards one-shot recipient and body to the engine over private stdin", () => {
  const invocation = prepareEngineInvocation([
    "send",
    "+12025550101",
    "fixture",
    "message"
  ]);

  expect(invocation.kind).toBe("spawn");
  if (invocation.kind !== "spawn") throw new Error("expected an engine spawn");
  expect(invocation.args).toEqual(["send-stdin"]);
  expect(invocation.args.join(" ")).not.toContain("+12025550101");
  expect(invocation.args.join(" ")).not.toContain("fixture message");
  expect(JSON.parse(invocation.stdin ?? "")).toEqual({
    recipient: "+12025550101",
    body: "fixture message"
  });
});

test("leaves non-send engine commands unchanged", () => {
  expect(prepareEngineInvocation(["doctor", "--json"])).toEqual({
    kind: "spawn",
    args: ["doctor", "--json"]
  });
});

test("shows help instead of reinterpreting a help flag as message text", () => {
  expect(prepareEngineInvocation(["send", "alice", "--help"])).toEqual({
    kind: "send_help"
  });
});

test("requires a separator before option-like message text", () => {
  let diagnostic = "";
  try {
    prepareEngineInvocation(["send", "alice", "--fixture-private-text"]);
  } catch (error) {
    diagnostic = error instanceof Error ? error.message : String(error);
  }
  expect(diagnostic).toContain("use -- before option-like message text");
  expect(diagnostic).not.toContain("--fixture-private-text");
  const invocation = prepareEngineInvocation(["send", "alice", "--", "--fixture"]);
  expect(invocation.kind).toBe("spawn");
  if (invocation.kind !== "spawn") throw new Error("expected an engine spawn");
  expect(JSON.parse(invocation.stdin ?? "")).toEqual({
    recipient: "alice",
    body: "--fixture"
  });
});

test("honors a separator before the recipient for literal option-like text", () => {
  const invocation = prepareEngineInvocation(["send", "--", "alice", "--help"]);
  expect(invocation.kind).toBe("spawn");
  if (invocation.kind !== "spawn") throw new Error("expected an engine spawn");
  expect(JSON.parse(invocation.stdin ?? "")).toEqual({
    recipient: "alice",
    body: "--help"
  });
});

test("rejects an incomplete send without putting its recipient in engine argv", () => {
  expect(() => prepareEngineInvocation(["send", "alice"])).toThrow(
    "Usage: blupost send"
  );
});

test.serial(
  "flushes the private send payload before closing engine stdin",
  async () => {
    const cli = resolve(import.meta.dir, "../../src/cli.ts");
    const engine = resolve(import.meta.dir, "../support/stdinCaptureEngine.ts");
    const child = Bun.spawn({
      cmd: [process.execPath, cli, "send", "fixture_alias", "fixture message"],
      env: {...process.env, BLUPOST_ENGINE: engine},
      stdout: "pipe",
      stderr: "pipe"
    });

    expect(await child.exited).toBe(0);
    expect(await new Response(child.stdout).text()).toBe("");
    expect(await new Response(child.stderr).text()).toBe("");
  }
);

test.serial(
  "handles send help and incomplete input before resolving an engine",
  async () => {
    const cli = resolve(import.meta.dir, "../../src/cli.ts");
    const environment = {
      ...process.env,
      BLUPOST_ENGINE: "/fixture/path/that-must-not-be-spawned"
    };
    const help = Bun.spawn({
      cmd: [process.execPath, cli, "send", "fixture_alias", "--help"],
      env: environment,
      stdout: "pipe",
      stderr: "pipe"
    });
    expect(await help.exited).toBe(0);
    expect(await new Response(help.stdout).text()).toContain(
      "blupost send <contact-or-number>"
    );
    expect(await new Response(help.stderr).text()).toBe("");

    const incomplete = Bun.spawn({
      cmd: [process.execPath, cli, "send", "fixture_alias"],
      env: environment,
      stdout: "pipe",
      stderr: "pipe"
    });
    expect(await incomplete.exited).toBe(1);
    expect(await new Response(incomplete.stdout).text()).toBe("");
    expect(await new Response(incomplete.stderr).text()).toContain(
      "Usage: blupost send"
    );
  }
);
