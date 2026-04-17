import { initDb, insertCausalEvent } from '../dist/db.js';
import { buildContext } from '../dist/context.js';
import { randomUUID } from 'crypto';

await initDb();
console.log("✅ DB initialized\n");

// Seed 3 failures: DELETE without WHERE (1 user-corrected)
for (let i = 0; i < 3; i++) {
  insertCausalEvent({
    id: randomUUID(),
    anchor_id: randomUUID(),
    session_id: 'smoke-test',
    task: 'delete users from the database',
    action: 'DELETE FROM users',
    outcome: 'Deleted all 47000 rows — missing WHERE clause',
    pattern: 'broad-delete-without-where',
    signals: { system: 'FAILURE', user: i === 0 ? 'negative' : null, agent: null },
    final_label: 'FAILURE',
    confidence: i === 0 ? 1.0 : 0.8,
  });
}
console.log("✅ Seeded 3 failures (1 user-corrected)\n");

// Seed 2 successes with proven pattern
for (let i = 0; i < 2; i++) {
  insertCausalEvent({
    id: randomUUID(),
    anchor_id: randomUUID(),
    session_id: 'smoke-test',
    task: 'delete test users from the database',
    action: "DELETE FROM users WHERE role = 'test'",
    outcome: 'Deleted 12 test users successfully',
    pattern: 'targeted-delete-with-where-clause',
    signals: { system: 'SUCCESS', user: null, agent: 'success' },
    final_label: 'SUCCESS',
    confidence: 0.9,
  });
}
console.log("✅ Seeded 2 successes with proven pattern\n");

// Build context for a similar new task
const ctx = buildContext('delete users from database', 'DB_DELETE');

console.log("=== context_build result ===");
console.log(`Memory depth: ${ctx.memory_depth}`);
console.log(`Past failures ranked: ${ctx.past_failures.length}`);
console.log(`Successful patterns found: ${ctx.successful_patterns.length}`);
console.log(`Hard constraints derived: ${ctx.constraints.length}`);
console.log("\n--- instruction_patch (formatted output) ---");
console.log(ctx.instruction_patch);

const topFailure = ctx.past_failures[0];
const topSuccess = ctx.successful_patterns[0];

if (topFailure && topSuccess) {
  console.log(`\n✅ Top failure score: ${topFailure.score}`);
  console.log(`✅ Top success reinforcement: ${topSuccess.reinforcement}`);
  console.log("\n✅ SMOKE TEST PASSED — learning loop works correctly");
} else {
  console.error("\n❌ SMOKE TEST FAILED");
  process.exit(1);
}
