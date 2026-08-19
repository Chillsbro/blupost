#!/usr/bin/env bun

export {};

const decoder = new TextDecoder();
let buffered = "";
let stopping = false;

for await (const chunk of Bun.stdin.stream()) {
  buffered += decoder.decode(chunk, {stream: true});
  let newline = buffered.indexOf("\n");
  while (newline >= 0) {
    const line = buffered.slice(0, newline);
    buffered = buffered.slice(newline + 1);
    const command = JSON.parse(line) as {type: string; request_id: string};
    if (command.type === "hello") {
      console.log(
        JSON.stringify({
          type: "operation",
          request_id: command.request_id,
          operation: "connect",
          ok: true
        })
      );
    } else if (command.type === "shutdown") {
      console.log(
        JSON.stringify({
          type: "operation",
          request_id: command.request_id,
          operation: "shutdown",
          ok: true
        })
      );
      stopping = true;
      break;
    }
    newline = buffered.indexOf("\n");
  }
  if (stopping) break;
}
