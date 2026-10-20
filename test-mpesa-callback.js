
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { processCallback } = require("./mpesa-callback");

const db = new Database(":memory:");

db.exec(`
  CREATE TABLE donations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    checkout_request_id TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    result_code INTEGER,
    result_description TEXT,
    mpesa_receipt_number TEXT,
    updated_at TEXT
  );
`);

db.prepare(`
  INSERT INTO donations (checkout_request_id, status)
  VALUES (?, ?)
`).run("CHECKOUT-TEST-001", "pending");

function makeCallback(checkoutId, resultCode, receipt) {
  const items = receipt
    ? [{ Name: "MpesaReceiptNumber", Value: receipt }]
    : [];

  return {
    Body: {
      stkCallback: {
        CheckoutRequestID: checkoutId,
        ResultCode: resultCode,
        ResultDesc: resultCode === 0 ? "Success" : "Cancelled",
        CallbackMetadata: { Item: items }
      }
    }
  };
}

// Test 1: Successful callback remains pending.
let response = processCallback(
  db,
  makeCallback("CHECKOUT-TEST-001", 0, "TESTRECEIPT1")
);
assert.equal(response.httpStatus, 200);
assert.equal(
  db.prepare("SELECT status FROM donations WHERE checkout_request_id = ?")
    .get("CHECKOUT-TEST-001").status,
  "pending"
);
console.log("PASS: Successful callback does not mark payment as paid.");

// Test 2: Failed callback marks donation failed.
response = processCallback(
  db,
  makeCallback("CHECKOUT-TEST-001", 1032, null)
);
assert.equal(response.httpStatus, 200);
assert.equal(
  db.prepare("SELECT status FROM donations WHERE checkout_request_id = ?")
    .get("CHECKOUT-TEST-001").status,
  "failed"
);
console.log("PASS: Failed callback marks donation failed.");

// Test 3: Unknown checkout does not create a donation.
const before = db.prepare("SELECT COUNT(*) AS total FROM donations").get().total;
processCallback(db, makeCallback("UNKNOWN-CHECKOUT", 0, "FAKERECEIPT"));
const after = db.prepare("SELECT COUNT(*) AS total FROM donations").get().total;
assert.equal(after, before);
console.log("PASS: Unknown checkout does not create a donation.");

// Test 4: Invalid callback is rejected.
response = processCallback(db, {});
assert.equal(response.httpStatus, 400);
console.log("PASS: Invalid callback is rejected.");

db.close();
console.log("All callback tests passed.");
