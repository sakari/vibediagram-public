#!/usr/bin/env node
import { main, parseArgs } from "./main.js";

main(parseArgs(process.argv)).catch((err: unknown) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
