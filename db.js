import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL || "";
const isLocal = /localhost|127\.0\.0\.1/.test(url);

// SSL: default on for remote DBs (Railway's Postgres supports it). Override with
// PGSSL=disable if you ever hit "server does not support SSL connections".
const mode = (process.env.PGSSL || "").toLowerCase();
const ssl = mode === "disable" || mode === "false" ? false
  : mode === "require" || mode === "true" ? { rejectUnauthorized: false }
  : url && !isLocal ? { rejectUnauthorized: false } : false;

export const pool = new Pool({ connectionString: url, ssl });

export async function initDb() {
  if (!url) throw new Error("DATABASE_URL is not set — add a Postgres plugin on Railway and set the variable.");
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(sql);
  console.log("DB schema ready");
}

export const q = (text, params) => pool.query(text, params);
