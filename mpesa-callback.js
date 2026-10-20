
function processCallback(db, body) {
  const callback = body?.Body?.stkCallback;

  if (!callback) {
    return { httpStatus: 400, ResultCode: 1, ResultDesc: "Invalid callback payload." };
  }

  const checkoutRequestId = callback.CheckoutRequestID;
  const resultCode = Number(callback.ResultCode);
  const resultDescription = callback.ResultDesc || "No description provided";

  if (!checkoutRequestId || !Number.isFinite(resultCode)) {
    return { httpStatus: 400, ResultCode: 1, ResultDesc: "Missing transaction result details." };
  }

  const items = callback.CallbackMetadata?.Item || [];
  const metadata = Object.fromEntries(
    items.map((item) => [item.Name, item.Value])
  );
  const receiptNumber = metadata.MpesaReceiptNumber || null;

  const donation = db.prepare(`
    SELECT id, status
    FROM donations
    WHERE checkout_request_id = ?
  `).get(checkoutRequestId);

  if (!donation) {
    return { httpStatus: 200, ResultCode: 0, ResultDesc: "No matching donation." };
  }

  if (donation.status === "paid") {
    return { httpStatus: 200, ResultCode: 0, ResultDesc: "Callback already processed." };
  }

  // A callback alone must not mark a donation as paid.
  const newStatus = resultCode === 0 ? "pending" : "failed";

  db.prepare(`
    UPDATE donations
    SET status = ?,
        result_code = ?,
        result_description = ?,
        mpesa_receipt_number = ?,
        updated_at = datetime('now')
    WHERE checkout_request_id = ?
  `).run(
    newStatus,
    resultCode,
    resultDescription,
    receiptNumber,
    checkoutRequestId
  );

  return { httpStatus: 200, ResultCode: 0, ResultDesc: "Callback processed." };
}

module.exports = { processCallback };
