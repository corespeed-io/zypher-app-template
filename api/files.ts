/**
 * Excalidraw file routes
 *
 *   /         — list / delete .excalidraw files
 *   /detail   — read / write / create a single .excalidraw file
 */
import { Hono } from "hono";
import { dirname, relative, resolve } from "@std/path";
import { walk } from "@std/fs/walk";

const PROJECT_ROOT = Deno.cwd();

const fileRoutes = new Hono()
  // ── File listing ─────────────────────────────────────────────────────────
  .get("/", async (c) => {
    const files: string[] = [];
    try {
      for await (
        const entry of walk(PROJECT_ROOT, {
          exts: [".excalidraw"],
          skip: [/node_modules/, /\.git/, /dist/],
          includeDirs: false,
        })
      ) {
        files.push(relative(PROJECT_ROOT, entry.path));
      }
      files.sort();
      return c.json(files);
    } catch (err) {
      console.error("[API] Error listing files:", err);
      return c.json({ error: "Failed to list files" }, 500);
    }
  })
  // ── Delete all .excalidraw files ─────────────────────────────────────────
  .delete("/", async (c) => {
    try {
      for await (
        const entry of walk(PROJECT_ROOT, {
          exts: [".excalidraw"],
          skip: [/node_modules/, /\.git/, /dist/],
          includeDirs: false,
        })
      ) {
        await Deno.remove(entry.path);
      }
      return c.json({ ok: true });
    } catch (err) {
      console.error("[API] Error deleting files:", err);
      return c.json({ error: "Failed to delete files" }, 500);
    }
  })
  // ── File read ────────────────────────────────────────────────────────────
  .get("/detail", async (c) => {
    const filePath = c.req.query("path");
    if (!filePath) return c.json({ error: "path query param required" }, 400);

    const absPath = resolve(PROJECT_ROOT, filePath);
    if (!absPath.startsWith(PROJECT_ROOT)) {
      return c.json({ error: "Path traversal not allowed" }, 403);
    }

    try {
      const content = await Deno.readTextFile(absPath);
      return c.json(JSON.parse(content));
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        return c.json({ error: "File not found" }, 404);
      }
      return c.json({ error: "Failed to read file" }, 500);
    }
  })
  // ── File write (user edits in Excalidraw UI) ────────────────────────────
  .put("/detail", async (c) => {
    const filePath = c.req.query("path");
    if (!filePath) return c.json({ error: "path query param required" }, 400);

    const absPath = resolve(PROJECT_ROOT, filePath);
    if (!absPath.startsWith(PROJECT_ROOT)) {
      return c.json({ error: "Path traversal not allowed" }, 403);
    }

    try {
      const body = await c.req.json();
      await Deno.mkdir(dirname(absPath), { recursive: true });
      await Deno.writeTextFile(absPath, JSON.stringify(body, null, 2));
      return c.json({ ok: true });
    } catch (err) {
      console.error("[API] Error writing file:", err);
      return c.json({ error: "Failed to write file" }, 500);
    }
  })
  // ── File create ──────────────────────────────────────────────────────────
  .post("/detail", async (c) => {
    const filePath = c.req.query("path");
    if (!filePath) return c.json({ error: "path query param required" }, 400);

    const absPath = resolve(PROJECT_ROOT, filePath);
    if (!absPath.startsWith(PROJECT_ROOT)) {
      return c.json({ error: "Path traversal not allowed" }, 403);
    }

    try {
      await Deno.stat(absPath);
      return c.json({ error: "File already exists" }, 409);
    } catch {
      // File doesn't exist, continue
    }

    const emptyDiagram = {
      type: "excalidraw",
      version: 2,
      source: "diagramming-agent",
      elements: [],
      appState: { gridSize: null, viewBackgroundColor: "#ffffff" },
      files: {},
    };

    try {
      await Deno.mkdir(dirname(absPath), { recursive: true });
      await Deno.writeTextFile(absPath, JSON.stringify(emptyDiagram, null, 2));
      return c.json({ ok: true }, 201);
    } catch {
      return c.json({ error: "Failed to create file" }, 500);
    }
  });

export default fileRoutes;
