import { spawnSync } from "node:child_process";
import pg from "pg";

const { Pool } = pg;
const TEST_DB_URL = "postgres://pursuit_test:pursuit_test@localhost:5433/pursuit_test";

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: true });
  return r.status ?? 1;
}

async function waitForDb() {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      await pool.query("SELECT 1");
      await pool.end();
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  await pool.end().catch(() => {});
  return false;
}

async function main() {
  console.log("Starting test database...");
  run("docker", ["compose", "up", "-d", "test-db"]);
  try {
    console.log("Waiting for test database to be ready...");
    const ready = await waitForDb();
    if (!ready) {
      console.error("Test database did not become ready within 20s.");
      process.exitCode = 1;
      return;
    }
    process.env.DATABASE_URL = TEST_DB_URL;
    console.log("Running integration tests...");
    process.exitCode = run("node", ["--test", "tests/integration/*.test.mjs"]);
  } finally {
    console.log("Stopping test database...");
    run("docker", ["compose", "down"]);
  }
}

main();
