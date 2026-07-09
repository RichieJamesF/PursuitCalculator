import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL || "";
const isLocal = /localhost|127\.0\.0\.1/.test(url);

export const pool = new Pool({
  connectionString: url,
  ssl: url && !isLocal ? { rejectUnauthorized: false } : false,
});

export async function initDb() {
  if (!url) throw new Error("DATABASE_URL is not set — add a Postgres plugin on Railway and set the variable.");
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(sql);
  console.log("DB schema ready");
}

export const q = (text, params) => pool.query(text, params);
