import { initDb, insertCausalEvent, getAllCausalEvents, querySimilarFailures } from '../dist/db.js';
import { randomUUID } from 'crypto';

await initDb();
console.log("✅ DB initialized");

// Check what's in DB from previous runs
const existing = getAllCausalEvents();
console.log(`Existing records in DB: ${existing.length}`);

// Seed 1 failure
insertCausalEvent({
  id: randomUUID(),
  anchor_id: randomUUID(),
  session_id: 'debug-test',
  task: 'delete users from the database',
  action: 'DELETE FROM users',
  outcome: 'Deleted all rows',
  pattern: 'broad-delete-without-where',
  signals: { system: 'FAILURE', user: 'negative', agent: null },
  final_label: 'FAILURE',
  confidence: 1.0,
});

const afterInsert = getAllCausalEvents();
console.log(`Records after insert: ${afterInsert.length}`);

// Try direct query
const results = querySimilarFailures('delete users', 5);
console.log(`querySimilarFailures('delete users') returned: ${results.length}`);

if (results.length > 0) {
  console.log("First result:", JSON.stringify(results[0], null, 2));
}
