export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const fmtDur = (s) => { if (!Number.isFinite(s)) return "—"; s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`; };
export const fmtGap = (s) => { s = Math.round(s); return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
export const addClock = (hhmm, secs) => { const [h, m] = (hhmm || "09:30").split(":").map(Number); const t = h * 3600 + m * 60 + Math.round(secs); return `${String(Math.floor(t / 3600) % 24).padStart(2, "0")}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
export const gid = () => "g" + Math.random().toString(16).slice(2, 8);
