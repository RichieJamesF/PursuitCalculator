import express from "express";
import { q } from "../db.js";
import { getEvent, requireOrg, eventPayload, token, genCode, clampGroupSize, truncate, asyncRoute } from "./helpers.js";
import { buildManualCourse } from "../lib/engine.mjs";

const router = express.Router();

router.post("/api/events", asyncRoute(async (req, res) => {
  const name = truncate(req.body?.name, 80, "Pursuit");
  let code = (req.body?.code || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-|-$/g, "") || genCode();
  const orgToken = token();
  const course = buildManualCourse(45, 500);
  try {
    const { rows } = await q(
      "INSERT INTO events(code,name,organiser_token,course_json,params_json,group_size,first_start,groups_json) VALUES($1,$2,$3,$4,$5,$6,$7,'[]') RETURNING *",
      [code, name, orgToken, course, {}, 2, "09:30"]
    );
    res.json({ ...(await eventPayload(rows[0])), organiserToken: orgToken });
  } catch (e) {
    if (String(e.message).includes("duplicate")) return res.status(409).json({ error: "That event code is taken — pick another." });
    throw e;
  }
}));

router.get("/api/events/:code", asyncRoute(async (req, res) => {
  const ev = await getEvent(req.params.code);
  if (!ev) return res.status(404).json({ error: "No event with that code." });
  res.json(await eventPayload(ev));
}));

router.patch("/api/events/:code", asyncRoute(async (req, res) => {
  const ev = await getEvent(req.params.code);
  if (!requireOrg(ev, req, res)) return;
  const b = req.body || {};
  const name = truncate(b.name, 80, ev.name);
  const groupSize = clampGroupSize(b.groupSize, ev.group_size);
  const firstStart = b.firstStart != null ? String(b.firstStart).slice(0, 5) : ev.first_start;
  let course = ev.course_json;
  if (b.courseManual) course = buildManualCourse(Number(b.courseManual.km) || 45, Number(b.courseManual.ascent) || 0, (b.params || ev.params_json || {}).climbGrad || 0.05);
  else if (b.course != null) course = b.course;   // or a pre-parsed { segments, distanceM, ascentM, name } (e.g. from a GPX/FIT parsed in the browser)
  const params = b.params != null ? b.params : ev.params_json;
  const { rows } = await q(
    "UPDATE events SET name=$1,group_size=$2,first_start=$3,course_json=$4,params_json=$5 WHERE id=$6 RETURNING *",
    [name, groupSize, firstStart, course, params, ev.id]
  );
  res.json(await eventPayload(rows[0]));
}));

export default router;
