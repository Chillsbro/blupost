#!/usr/bin/env bun
import {existsSync} from "node:fs";

await import(
  existsSync(new URL("../dist/blupost.js", import.meta.url))
    ? "../dist/blupost.js"
    : "../src/cli.ts"
);
