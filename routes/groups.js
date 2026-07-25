import express from "express";
import { q } from "../db.js";
import { getEvent, getRiders, requireOrg, eventPayload, paramsOf, engineRidersById, clampGroupSize, groupId, asyncRoute } from "./helpers.js";
import { suggestGroups } from "../lib/engine.mjs";

const router = express.Router();

router.post("/api/events/:code/suggest", asyncRoute(async (req, res) => {
  const ev = await getEvent(req.params.code);
  if (!requireOrg(ev, req, res)) return;
  if (!ev.course_json) return res.status(400).json({ error: "Set a course first." });
  const riders = await getRiders(ev.id);
  const byId = engineRidersById(riders);
  const locked = (ev.groups_json || []).filter((g) => g.locked);
  const lockedIds = new Set(locked.flatMap((g) => g.members.map(String)));
  const pool = riders.map((r) => r.id).filter((id) => !lockedIds.has(String(id)));
  const size = clampGroupSize(req.body?.size, ev.group_size);
  const { groups, leftover } = suggestGroups(pool, byId, ev.course_json.segments, paramsOf(ev), size);
  const newGroups = [...locked, ...groups.map((m) => ({ id: groupId(), members: m, locked: false }))];
  await q("UPDATE events SET groups_json=$1, group_size=$2 WHERE id=$3", [JSON.stringify(newGroups), size, ev.id]);
  const updated = await getEvent(ev.code);
  res.json({ ...(await eventPayload(updated)), leftover });
}));

// save a manual arrangement
router.put("/api/events/:code/groups", asyncRoute(async (req, res) => {
  const ev = await getEvent(req.params.code);
  if (!requireOrg(ev, req, res)) return;
  const groups = Array.isArray(req.body?.groups) ? req.body.groups : [];
  await q("UPDATE events SET groups_json=$1 WHERE id=$2", [JSON.stringify(groups), ev.id]);
  res.json(await eventPayload(await getEvent(ev.code)));
}));

export default router;
