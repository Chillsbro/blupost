#!/usr/bin/env bun
import {
  type CliRenderer,
  createClipboard,
  createCliRenderer,
  createHostClipboard,
  createRendererClipboardAdapter
} from "@opentui/core";
import {createEngineClient, resolveEngineBinary} from "./engine/createEngineClient.js";
import {prepareEngineInvocation} from "./engine/prepareEngineInvocation.js";
import {createBlupostTui} from "./tui/index.js";
import {terminalIsInteractive} from "./tui/motion.js";
import {blupostTheme} from "./tui/theme.js";

function printHelp(): void {
  process.stdout.write(`blupost — session-based iPhone texting for Linux

Usage:
  blupost             Open the interactive terminal chat
  blupost doctor      Inspect Bluetooth and MAP availability
  blupost send <contact-or-number> [--] <message>
  blupost watch --plain
  blupost contacts list|add|update|remove
  blupost --help      Show this help
`);
}

function printSendHelp(): void {
  process.stdout.write(`Send one explicit message; attempts are never retried.

Usage:
  blupost send <contact-or-number> [--] <message>

Use -- before a message that begins with '-'.
`);
}

async function forwardEngine(args: string[]): Promise<void> {
  const invocation = prepareEngineInvocation(args);
  if (invocation.kind === "send_help") {
    printSendHelp();
    return;
  }
  const binary = await resolveEngineBinary();
  if (invocation.stdin !== undefined) {
    const child = Bun.spawn({
      cmd: [binary, ...invocation.args],
      stdin: "pipe",
      stdout: "inherit",
      stderr: "inherit"
    });
    child.stdin.write(invocation.stdin);
    await child.stdin.flush();
    child.stdin.end();
    process.exitCode = await child.exited;
    return;
  }
  const child = Bun.spawn({
    cmd: [binary, ...invocation.args],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit"
  });
  const preserveWatchShutdown = invocation.args[0] === "watch";
  const handleInterrupt = (): void => {};
  if (preserveWatchShutdown) process.on("SIGINT", handleInterrupt);
  try {
    process.exitCode = await child.exited;
  } finally {
    if (preserveWatchShutdown) process.off("SIGINT", handleInterrupt);
  }
}

interface TextClipboard {
  copyText(text: string): Promise<"copied" | "terminal-attempted">;
  dispose(): Promise<void>;
}

function createTextClipboard(renderer: CliRenderer): TextClipboard {
  try {
    const clipboard = createClipboard({
      host: createHostClipboard(),
      terminal: createRendererClipboardAdapter(renderer)
    });
    return {
      async copyText(text) {
        try {
          const result = await clipboard.writeText(text, {
            destination: "best-available"
          });
          if (result.host.status === "written") return "copied";
          if (result.terminal.status === "attempted") return "terminal-attempted";
        } catch {
          // Fall through to the terminal clipboard when the host provider fails.
        }
        if (renderer.copyToClipboardOSC52(text)) return "terminal-attempted";
        throw new Error("clipboard unavailable");
      },
      dispose: () => clipboard.dispose()
    };
  } catch {
    return {
      async copyText(text) {
        if (renderer.copyToClipboardOSC52(text)) return "terminal-attempted";
        throw new Error("clipboard unavailable");
      },
      async dispose() {}
    };
  }
}

async function runInteractive(): Promise<void> {
  const renderer = await createCliRenderer({
    stdin: process.stdin,
    stdout: process.stdout,
    exitOnCtrlC: false,
    screenMode: "alternate-screen",
    useMouse: true,
    targetFps: 30,
    maxFps: 60,
    backgroundColor: blupostTheme.background,
    consoleMode: "disabled"
  });
  const clipboard = createTextClipboard(renderer);
  let app: ReturnType<typeof createBlupostTui> | undefined;
  try {
    app = createBlupostTui({
      renderer,
      engine: createEngineClient(),
      interactive: terminalIsInteractive(process.stdin.isTTY, process.stdout.isTTY),
      copyText: text => clipboard.copyText(text)
    });
    await app.start();
    await app.waitUntilExit();
  } catch (error) {
    try {
      if (app)
        await app.stop(error instanceof Error ? error : new Error(String(error)));
      else renderer.destroy();
    } catch {
      // Preserve the startup failure; cleanup is best-effort after construction fails.
    }
    throw error;
  } finally {
    await clipboard.dispose().catch(() => {});
  }
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  if (args[0] === "-h" || args[0] === "--help" || args[0] === "help") {
    printHelp();
    return;
  }
  if (args.length > 0) {
    await forwardEngine(args);
    return;
  }

  await runInteractive();
}

await main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
