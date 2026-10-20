
const assert = require("node:assert/strict");

console.log("PEFA callback safety test setup");

// This is a setup check only. It does not send callbacks
// or modify donation records.
const db = require("./database");

const columns = db.prepare("PRAGMA table_info(donations)").all();
const columnNames = columns.map((column) => column.name);

for (const required of [
  "checkout_request_id",
  "status",
  "result_code",
  "mpesa_receipt_number"
]) {
  assert.ok(
    columnNames.includes(required),
    `Missing required donations column: ${required}`
  );
}

console.log("PASS: Required donation columns exist.");
console.log("No donation records were changed.");
