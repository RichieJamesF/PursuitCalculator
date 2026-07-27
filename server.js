import express from "express";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initDb } from "./db.js";
import eventsRouter from "./routes/events.js";
import ridersRouter from "./routes/riders.js";
import groupsRouter from "./routes/groups.js";
import stravaRouter from "./routes/strava.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  // The organiser's own Strava link carries their edit-everything key in a query string
  // (see ADR-0003) that then 302s to strava.com; a legacy no-referrer-when-downgrade
  // default would leak that whole URL cross-origin, so pin the policy explicitly.
  app.use((_req, res, next) => { res.setHeader("Referrer-Policy", "no-referrer"); next(); });
  app.use(express.json({ limit: "1mb" }));
  app.use(express.static(path.join(__dirname, "public"), {
    setHeaders: (res, p) => { if (/\.(js|mjs|css|html)$/.test(p)) res.setHeader("Cache-Control", "no-cache"); },
  }));

  app.use(eventsRouter);
  app.use(ridersRouter);
  app.use(groupsRouter);
  app.use(stravaRouter);

  // serve the shared engine to the browser (single source of truth, no duplication)
  app.get("/engine.mjs", (_req, res) => { res.setHeader("Cache-Control", "no-cache"); res.type("application/javascript").sendFile(path.join(__dirname, "lib", "engine.mjs")); });
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "Something went wrong." });
  });

  return app;
}

const PORT = process.env.PORT || 3000;
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  initDb()
    .then(() => createApp().listen(PORT, () => console.log(`Pursuit server on :${PORT}`)))
    .catch((e) => { console.error("Startup failed:", e.message); process.exit(1); });
}
