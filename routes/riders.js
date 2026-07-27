import express from "express";
import { q } from "../db.js";
import { getEvent, eventForRider, getRider, requireRiderOrOrg, publicRider, truncate, token, asyncRoute } from "./helpers.js";

const router = express.Router();

// public self sign-up — mints the rider's own key, returned exactly once
router.post("/api/events/:code/riders", asyncRoute(async (req, res) => {
  const ev = await getEvent(req.params.code);
  if (!ev) return res.status(404).json({ error: "No event with that code." });
  const b = req.body || {};
  if (!b.name?.trim()) return res.status(400).json({ error: "Name is required." });
  const riderKey = token();
  const { rows } = await q(
    "INSERT INTO riders(event_id,name,weight,ftp,pos,build,rider_token) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
    [ev.id, truncate(b.name.trim(), 60, ""), Number(b.w) || 75, Number(b.ftp) || 240, b.pos || "road_drops", b.build || "medium", riderKey]
  );
  res.json({ ...publicRider(rows[0]), riderKey });
}));

router.patch("/api/riders/:id", asyncRoute(async (req, res) => {
  const ev = await eventForRider(req.params.id);
  const r = await getRider(req.params.id);
  if (!requireRiderOrOrg(ev, r, req, res)) return;
  const b = req.body || {};
  // Every rider can reach this now (ADR-0003), not just the organiser, so the same floors
  // the client enforces have to hold server-side too — a devtools console bypasses the client.
  const name = b.name != null ? String(b.name).trim() : null;
  if (b.name != null && !name) return res.status(400).json({ error: "Name can't be blank." });
  let w = r.weight;
  if (b.w != null) { w = Number(b.w); if (!Number.isFinite(w) || w <= 30) return res.status(400).json({ error: "Weight must be a number above 30 kg." }); }
  let ftp = r.ftp;
  if (b.ftp != null) { ftp = Number(b.ftp); if (!Number.isFinite(ftp) || ftp <= 50) return res.status(400).json({ error: "FTP must be a number above 50 W." }); }
  const { rows } = await q(
    "UPDATE riders SET name=$1,weight=$2,ftp=$3,pos=$4,build=$5 WHERE id=$6 RETURNING *",
    [truncate(name, 60, r.name), w, ftp, b.pos || r.pos, b.build || r.build, r.id]
  );
  res.json(publicRider(rows[0]));
}));

router.delete("/api/riders/:id", asyncRoute(async (req, res) => {
  const ev = await eventForRider(req.params.id);
  const r = await getRider(req.params.id);
  if (!requireRiderOrOrg(ev, r, req, res)) return;
  await q("DELETE FROM riders WHERE id=$1", [r.id]);
  // drop the rider from any stored groups
  const groups = (ev.groups_json || []).map((g) => ({ ...g, members: g.members.filter((m) => String(m) !== String(r.id)) })).filter((g) => g.members.length || g.locked);
  await q("UPDATE events SET groups_json=$1 WHERE id=$2", [JSON.stringify(groups), ev.id]);
  res.json({ ok: true });
}));

export default router;
