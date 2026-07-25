import { createApp } from "../../server.js";
import { pool, initDb, q } from "../../db.js";

let schemaReady = false;

export async function startTestServer() {
  if (!schemaReady) { await initDb(); schemaReady = true; }
  await q("TRUNCATE riders, events RESTART IDENTITY CASCADE");
  const app = createApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

export async function stopTestServer(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

export async function closePool() {
  await pool.end();
}
