export type EngineInvocation =
  | {kind: "spawn"; args: string[]; stdin?: string}
  | {kind: "send_help"};

const SEND_USAGE = "Usage: blupost send <contact-or-number> [--] <message>";

function optionError(): Error {
  return new Error("unknown send option; use -- before option-like message text");
}

/** Keep every attempted one-shot recipient and body out of native engine arguments. */
export function prepareEngineInvocation(args: string[]): EngineInvocation {
  if (args[0] !== "send") return {kind: "spawn", args};

  let recipientIndex = 1;
  const optionsEndedBeforeRecipient = args[recipientIndex] === "--";
  if (optionsEndedBeforeRecipient) recipientIndex += 1;
  const recipient = args[recipientIndex];
  if (recipient === "-h" || recipient === "--help") return {kind: "send_help"};
  if (recipient === undefined) throw new Error(SEND_USAGE);
  if (recipient.startsWith("-")) throw optionError();

  const messageArguments = args.slice(recipientIndex + 1);
  const separator = optionsEndedBeforeRecipient ? -1 : messageArguments.indexOf("--");
  const optionScope = optionsEndedBeforeRecipient
    ? []
    : separator >= 0
      ? messageArguments.slice(0, separator)
      : messageArguments;
  if (optionScope.some(argument => argument === "-h" || argument === "--help")) {
    return {kind: "send_help"};
  }
  const unknownOption = optionScope.find(
    argument => argument !== "-" && argument.startsWith("-")
  );
  if (unknownOption !== undefined) throw optionError();

  const bodyArguments =
    separator >= 0
      ? [
          ...messageArguments.slice(0, separator),
          ...messageArguments.slice(separator + 1)
        ]
      : messageArguments;
  if (bodyArguments.length === 0) throw new Error(SEND_USAGE);

  return {
    kind: "spawn",
    args: ["send-stdin"],
    stdin: JSON.stringify({recipient, body: bodyArguments.join(" ")})
  };
}
