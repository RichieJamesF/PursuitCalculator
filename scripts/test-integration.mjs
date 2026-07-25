import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const USER = "pursuit_test";
const PASSWORD = "pursuit_test";
const DATABASE = "pursuit_test";
const PORT = 5433;
const DATA_DIR = path.join(os.tmpdir(), `pursuit-test-pg-${process.pid}`);

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: true });
  return r.status ?? 1;
}

async function main() {
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: false,
  });

  let started = false;
  try {
    console.log("Starting embedded test database (no Docker required)...");
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase(DATABASE);

    process.env.DATABASE_URL = `postgres://${USER}:${PASSWORD}@localhost:${PORT}/${DATABASE}`;
    console.log("Running integration tests...");
    // --test-concurrency=1: integration test files share one embedded Postgres instance,
    // and each file's beforeEach TRUNCATEs the riders/events tables. Running files in
    // parallel (node's default) lets one file's TRUNCATE wipe data another file is
    // mid-request with, causing spurious 404s/undefined ids. Force sequential file execution.
    process.exitCode = run("node", ["--test", "--test-concurrency=1", "tests/integration/*.test.mjs"]);
  } finally {
    if (started) {
      console.log("Stopping embedded test database...");
      await pg.stop();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
