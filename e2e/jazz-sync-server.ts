/**
 * Local Jazz WebSocket sync server for e2e testing.
 *
 * Starts a WebSocket server that relays Jazz CRDT sync messages between
 * connected browser tabs, enabling multi-tab collaboration tests without
 * depending on an external Jazz Cloud instance.
 *
 * Usage:
 *   npx tsx e2e/jazz-sync-server.ts
 *
 * The port defaults to 4200 but can be overridden via JAZZ_SYNC_PORT env var.
 * Prints "JAZZ_SYNC_SERVER_READY on port <port>" to stdout so Playwright
 * can detect when the server is listening.
 */

import { createServer, type IncomingMessage } from "node:http";
import { type Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { createWebSocketPeer } from "cojson-transport-ws";
import { LocalNode } from "cojson";
import { PureJSCrypto } from "cojson/crypto/PureJSCrypto";

const DEFAULT_PORT = 4200;

async function main() {
  const port = Number(process.env.JAZZ_SYNC_PORT) || DEFAULT_PORT;
  const crypto = await PureJSCrypto.create();

  // Use withNewlyCreatedAccount so the node has a proper account identity,
  // which is required for sync protocol authentication handshakes.
  const { node: syncServerNode } = await LocalNode.withNewlyCreatedAccount({
    creationProps: { name: "E2E Sync Server" },
    crypto,
  });

  const server = createServer((req, res) => {
    // Health-check endpoint so Playwright can verify the server is alive.
    if (req.url === "/health") {
      res.writeHead(200);
      res.end("ok");
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ noServer: true });
  const connections = new Set<WebSocket>();

  wss.on("connection", (ws: WebSocket) => {
    connections.add(ws);

    const clientId = `e2e-client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const peer = createWebSocketPeer({
      id: clientId,
      // ws library's WebSocket satisfies the AnyWebSocket interface
      websocket: ws as unknown as Parameters<
        typeof createWebSocketPeer
      >[0]["websocket"],
      role: "server",
      // Browser clients in short-lived e2e sessions may not send pings
      expectPings: false,
      batchingByDefault: true,
    });

    syncServerNode.syncManager.addPeer(peer);

    // Send periodic empty messages so browser clients don't hit their
    // ping timeout (cojson resets its timer on every incoming message).
    const pingInterval = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.send("");
      }
    }, 5_000);

    ws.on("error", (err: Error) => {
      console.error(`[jazz-sync-server] Error on ${clientId}:`, err.message);
    });

    ws.on("close", () => {
      clearInterval(pingInterval);
      connections.delete(ws);
    });
  });

  // Upgrade HTTP connections to WebSocket (skip health-check path)
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (req.url === "/health") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  server.listen(port, () => {
    // Playwright watches stdout for this exact line to know the server is ready.
    console.log(`JAZZ_SYNC_SERVER_READY on port ${port}`);
  });

  // Graceful shutdown -- close all WebSocket connections then stop the server.
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log("[jazz-sync-server] Shutting down...");
    for (const ws of connections) {
      ws.close();
    }
    server.close(() => {
      console.log("[jazz-sync-server] Stopped.");
      process.exit(0);
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err: unknown) => {
  console.error("[jazz-sync-server] Fatal error:", err);
  process.exit(1);
});
