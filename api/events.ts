/**
 * File-change event routes
 *
 *   /ws  — WebSocket for .excalidraw file-change notifications
 *
 * Also starts a background file watcher that broadcasts changes
 * to all connected WebSocket clients.
 */
import { Hono } from "hono";
import { relative } from "@std/path";
import { walk } from "@std/fs/walk";

const PROJECT_ROOT = Deno.cwd();

// ── WebSocket file-change broadcaster ──────────────────────────────────────

const wsClients = new Set<WebSocket>();

function broadcast(data: object) {
  const msg = JSON.stringify(data);
  for (const ws of wsClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

// Start file watcher in background
(async () => {
  const debounce = new Map<string, ReturnType<typeof setTimeout>>();
  try {
    const watcher = Deno.watchFs(PROJECT_ROOT, { recursive: true });
    for await (const event of watcher) {
      for (const p of event.paths) {
        if (!p.endsWith(".excalidraw")) continue;
        if (p.includes("node_modules") || p.includes(".git")) continue;

        clearTimeout(debounce.get(p));
        debounce.set(
          p,
          setTimeout(() => {
            const eventType = event.kind === "create"
              ? "add"
              : event.kind === "remove"
              ? "unlink"
              : "change";
            broadcast({ event: eventType, path: relative(PROJECT_ROOT, p) });
          }, 300),
        );
      }
    }
  } catch (err) {
    console.error("[Watcher] Error:", err);
  }
})();

// ── Routes ─────────────────────────────────────────────────────────────────

const eventRoutes = new Hono()
  .get("/ws", (c) => {
    if (c.req.header("upgrade") !== "websocket") {
      return c.text("Expected WebSocket upgrade", 426);
    }
    const { socket, response } = Deno.upgradeWebSocket(c.req.raw);
    socket.onopen = async () => {
      wsClients.add(socket);
      // Replay existing .excalidraw files so reconnecting clients see current state
      try {
        for await (
          const entry of walk(PROJECT_ROOT, {
            exts: [".excalidraw"],
            skip: [/node_modules/, /\.git/, /dist/],
            includeDirs: false,
          })
        ) {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(
              JSON.stringify({
                event: "add",
                path: relative(PROJECT_ROOT, entry.path),
              }),
            );
          }
        }
      } catch (err) {
        console.error("[WS] Error replaying files:", err);
      }
    };
    socket.onclose = () => wsClients.delete(socket);
    socket.onerror = (e) => console.error("[WS] Error:", e);
    return response;
  });

export default eventRoutes;
