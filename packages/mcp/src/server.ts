/**
 * Quire MCP server (stdio). Lets Claude and other MCP clients find, read,
 * create and update HTML in the user's Quire library and open it in the app.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Library, defaultFolder, openInQuire } from "./library.js";

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});
const failure = (e: unknown) => ({ ...text(e instanceof Error ? e.message : String(e)), isError: true });

export async function startServer(version: string) {
  const lib = new Library();
  const server = new McpServer({ name: "quire", version });

  server.registerTool(
    "quire_list_files",
    {
      title: "List or search HTML files",
      description:
        "Lists HTML files in the user's Quire library, most recently opened first. With a query, searches file names, page titles and the visible text of every page.",
      inputSchema: { query: z.string().optional().describe("Words to search for"), limit: z.number().int().min(1).max(100).optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ query, limit }) => {
      try {
        return text(lib.list(query, limit ?? 25));
      } catch (e) {
        return failure(e);
      }
    },
  );

  server.registerTool(
    "quire_list_folders",
    {
      title: "List library folders",
      description: `Lists the folders in the user's Quire library. New files go to ${defaultFolder()} unless a folder is named.`,
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        return text({ folders: lib.folders(), defaultFolder: defaultFolder() });
      } catch (e) {
        return failure(e);
      }
    },
  );

  server.registerTool(
    "quire_read_file",
    {
      title: "Read an HTML file",
      description: "Returns the full HTML source of a file in the user's Quire library.",
      inputSchema: { path: z.string().describe("Absolute path, as returned by quire_list_files") },
      annotations: { readOnlyHint: true },
    },
    async ({ path }) => {
      try {
        const { html } = lib.readFile(path);
        return text(html);
      } catch (e) {
        return failure(e);
      }
    },
  );

  server.registerTool(
    "quire_create_file",
    {
      title: "Create an HTML file",
      description:
        "Saves a new, complete, self-contained HTML document to the user's Quire library and (by default) opens it in Quire. Never overwrites: a number is added if the name is taken. Use this to deliver dashboards, reports and pages to the user.",
      inputSchema: {
        name: z.string().describe("File name, e.g. 'Q3 sales dashboard.html'"),
        html: z.string().describe("The complete HTML document"),
        folder: z.string().optional().describe("Library folder name from quire_list_folders; defaults to ~/Quire"),
        open: z.boolean().optional().describe("Open it in Quire (default true)"),
      },
    },
    async ({ name, html, folder, open }) => {
      try {
        const path = lib.createFile(name, html, folder);
        if (open !== false) await openInQuire(path).catch(() => {});
        return text({ path, opened: open !== false });
      } catch (e) {
        return failure(e);
      }
    },
  );

  server.registerTool(
    "quire_update_file",
    {
      title: "Update an HTML file",
      description:
        "Replaces the HTML of an existing file in the user's Quire library. The previous version is kept in Quire's version history, and files open in Quire update live. Read the file first and send the complete new document.",
      inputSchema: {
        path: z.string().describe("Absolute path of an existing library file"),
        html: z.string().describe("The complete new HTML document"),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ path, html }) => {
      try {
        return text({ path: lib.updateFile(path, html), previousVersionSaved: true });
      } catch (e) {
        return failure(e);
      }
    },
  );

  server.registerTool(
    "quire_open",
    {
      title: "Open in Quire",
      description: "Opens a library file in the Quire app on the user's Mac.",
      inputSchema: { path: z.string() },
    },
    async ({ path }) => {
      try {
        const real = lib.resolveExisting(path);
        await openInQuire(real);
        return text({ opened: real });
      } catch (e) {
        return failure(e);
      }
    },
  );

  await server.connect(new StdioServerTransport());
}
