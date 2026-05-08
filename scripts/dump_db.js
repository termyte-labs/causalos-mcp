import initSqlJs from "sql.js";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const DB_PATH = join(homedir(), ".termyte", "memory.db");

async function dump() {
  if (!existsSync(DB_PATH)) {
    console.error(`Database not found at ${DB_PATH}`);
    process.exit(1);
  }

  const SQL = await initSqlJs();
  const fileBuffer = readFileSync(DB_PATH);
  const db = new SQL.Database(fileBuffer);

  console.log("--- causal_events structure ---");
  const schema = db.prepare("PRAGMA table_info(causal_events)");
  while (schema.step()) {
    console.log(JSON.stringify(schema.getAsObject(), null, 2));
  }
  schema.free();

  console.log("\n--- causal_events (Last 20) ---");
  // Try to query without project_name if it fails, or just get everything
  const events = db.prepare("SELECT * FROM causal_events ORDER BY created_at DESC LIMIT 20");
  while (events.step()) {
    console.log(JSON.stringify(events.getAsObject(), null, 2));
  }
  events.free();

  console.log("\n--- anchors (Pending) ---");
  const anchors = db.prepare("SELECT task, status, created_at FROM anchors WHERE status = 'PENDING' LIMIT 10");
  while (anchors.step()) {
    console.log(JSON.stringify(anchors.getAsObject(), null, 2));
  }
  anchors.free();

  db.close();
}

dump().catch(console.error);
