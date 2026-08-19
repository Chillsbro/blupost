#!/usr/bin/env bun

export {};

const decoder = new TextDecoder();
let buffered = "";

for await (const chunk of Bun.stdin.stream()) {
  buffered += decoder.decode(chunk, {stream: true});
  const newline = buffered.indexOf("\n");
  if (newline < 0) continue;
  const command = JSON.parse(buffered.slice(0, newline)) as {
    type: string;
    request_id: string;
  };
  if (command.type === "hello") {
    console.log(
      JSON.stringify({
        type: "error",
        request_id: command.request_id,
        code: "protocol_version",
        message: "synthetic hello rejection"
      })
    );
  }
  break;
}
