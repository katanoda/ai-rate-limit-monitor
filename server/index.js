import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { PORT, POLL_INTERVAL_MS } from "./config.js";
import { getCache } from "./cache.js";
import { startPoller } from "./poller.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/limits", (_req, res) => {
  res.json({ ...getCache(), pollIntervalMs: POLL_INTERVAL_MS });
});

startPoller();

app.listen(PORT, () => {
  console.log(`limit-monitor: http://localhost:${PORT}`);
});
