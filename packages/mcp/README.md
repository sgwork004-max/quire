# Quire CLI and MCP server

Lets Claude (and any other MCP client or script) work with your Quire library: list and search your HTML files, read them, create new ones and update existing ones, and open them in the Quire app.

Everything stays on your Mac. Reads come from Quire's local index; writes are limited to HTML files inside your library folders (new files go to `~/Quire`), and an existing file's previous content is saved to Quire's version history before it's overwritten, so any change can be undone from the app.

Requires Node 22.13+ and the Quire app (open it once so the library exists).

## Build

```bash
cd packages/mcp && pnpm install && pnpm build
```

## Connect Claude

**Easiest:** the Quire app has this server built in. Open Quire › Settings › Claude and click **Connect** for the Claude app and/or Claude Code. (It runs `Quire.app/Contents/MacOS/quire mcp`; no Node needed.)

To use this Node version instead (for development):

**Claude Code**

```bash
claude mcp add quire -- node ~/Developer/quire/packages/mcp/dist/cli.js mcp
```

**Claude Desktop**: Settings → Developer → Edit Config, and add:

```json
{
  "mcpServers": {
    "quire": {
      "command": "node",
      "args": ["/Users/YOU/Developer/quire/packages/mcp/dist/cli.js", "mcp"]
    }
  }
}
```

Then ask Claude things like *"Make a dashboard of these numbers and save it to Quire"* or *"Find my Q3 report in Quire and add a summary at the top"*.

| Tool | What it does |
| --- | --- |
| `quire_list_files` | Recent files, or full-text search over names, titles and page text |
| `quire_list_folders` | Library folders, and where new files go |
| `quire_read_file` | The HTML source of a library file |
| `quire_create_file` | Saves a new HTML file (never overwrites) and opens it in Quire |
| `quire_update_file` | Replaces a library file's HTML, keeping the old version in history |
| `quire_open` | Opens a library file in Quire |

## Command line

```bash
alias quire="node ~/Developer/quire/packages/mcp/dist/cli.js"
quire ls                      # recent files
quire ls revenue mumbai       # search
quire cat report.html         # print HTML
quire new "Q3 report" < q3.html   # create from a file (or a blank page) and open it
quire put report.html < v2.html   # replace (old version kept in Quire's history)
quire open report.html
```
