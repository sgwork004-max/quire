#!/usr/bin/env -S node --no-warnings=ExperimentalWarning
/**
 * quire: command-line access to your Quire library.
 *
 *   quire ls [search words]        list recent files, or search them
 *   quire folders                  list library folders
 *   quire cat <file>               print a file's HTML
 *   quire new <name> [< file]      create a file from stdin (or a blank page) and open it
 *   quire put <file> [< file]      replace a file's HTML from stdin (old version kept)
 *   quire open <file>              open a file in Quire
 *   quire mcp                      run the MCP server for Claude and other AI tools
 */
import { readFileSync } from "node:fs";

// node:sqlite prints an "experimental" warning on load; it's noise for a CLI.
process.removeAllListeners("warning");
const { Library, openInQuire } = await import("./library.js");

const VERSION = "0.1.0";
const BLANK = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Untitled</title></head>
<body>
  <h1>Untitled</h1>
</body>
</html>
`;

function stdin(): string | null {
  if (process.stdin.isTTY) return null;
  return readFileSync(0, "utf8");
}

async function main(argv: string[]) {
  const [cmd, ...args] = argv;
  if (cmd === "mcp") {
    const { startServer } = await import("./server.js");
    return startServer(VERSION);
  }
  const lib = new Library();
  switch (cmd) {
    case "ls": {
      for (const f of lib.list(args.join(" ") || undefined, 50)) {
        console.log(`${f.title ?? f.name}\n  ${f.path}${f.snippet ? `\n  ${f.snippet}` : ""}`);
      }
      return;
    }
    case "folders":
      for (const f of lib.folders()) console.log(`${f.name} (${f.files})\n  ${f.path}`);
      return;
    case "cat":
      if (!args[0]) throw new Error("Usage: quire cat <file>");
      process.stdout.write(lib.readFile(args[0]).html);
      return;
    case "new": {
      if (!args[0]) throw new Error("Usage: quire new <name> [--folder <folder>] [< file.html]");
      const folderIdx = args.indexOf("--folder");
      const folder = folderIdx >= 0 ? args[folderIdx + 1] : undefined;
      const path = lib.createFile(args[0], stdin() ?? BLANK, folder);
      console.log(path);
      await openInQuire(path).catch((e) => console.error(e.message));
      return;
    }
    case "put": {
      const html = stdin();
      if (!args[0] || html === null) throw new Error("Usage: quire put <file> < new.html");
      console.log(lib.updateFile(args[0], html));
      return;
    }
    case "open":
      if (!args[0]) throw new Error("Usage: quire open <file>");
      await openInQuire(lib.resolveExisting(args[0]));
      return;
    case "--version":
    case "-v":
      console.log(VERSION);
      return;
    default:
      console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(2, 13).map((l) => l.replace(/^ \* ?/, "")).join("\n"));
  }
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
