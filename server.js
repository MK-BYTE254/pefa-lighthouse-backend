
require("dotenv").config();

const express = require("express");
const db = require("./database");
const { processCallback } = require("./mpesa-callback");

const app = express();
const PORT = process.env.PORT || 3000;
const DARAJA_ENV = process.env.DARAJA_ENV || "sandbox";

app.use(express.json({ limit: "100kb" }));

// 1. Backend health check
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "PEFA Lighthouse backend is running!"
  });
});

// 2. Giving service status
// Payments remain disabled until secure payment confirmation is ready.
app.get("/api/giving/status", (req, res) => {
  res.json({
    success: true,
    message: "Giving service is online.",
    paymentsEnabled: false
  });
});

// 3. Daraja Sandbox authentication test
app.get("/api/daraja/test-token", async (req, res) => {
  if (DARAJA_ENV !== "sandbox") {
    return res.status(400).json({
      success: false,
      message: "This test route is restricted to sandbox mode."
    });
  }

  const consumerKey = process.env.DARAJA_CONSUMER_KEY;
  const consumerSecret = process.env.DARAJA_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    return res.status(500).json({
      success: false,
      message: "Daraja credentials are missing from backend configuration."
    });
  }

  try {
    const credentials = Buffer.from(
      `${consumerKey}:${consumerSecret}`
    ).toString("base64");

    const response = await fetch(
      "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        headers: {
          Authorization: `Basic ${credentials}`
        }
      }
    );

    const data = await response.json();

    if (!response.ok || !data.access_token) {
      console.error(
        "Daraja token request failed. HTTP status:",
        response.status
      );

      return res.status(502).json({
        success: false,
        message: "Daraja authentication failed. Check the sandbox credentials."
      });
    }

    return res.json({
      success: true,
      message: "Daraja sandbox authentication succeeded."
    });
  } catch (error) {
    console.error("Daraja connection error:", error.message);

    return res.status(502).json({
      success: false,
      message: "Could not connect to Daraja."
    });
  }
});

// 4. M-Pesa STK Push — Sandbox only
// An accepted request is NOT proof of a completed payment.
app.post("/api/mpesa/stk-push", async (req, res) => {
  if (DARAJA_ENV !== "sandbox") {
    return res.status(503).json({
      success: false,
      message: "This endpoint is restricted to Daraja Sandbox mode."
    });
  }

  const { amount, phoneNumber, givingType } = req.body || {};
  const paymentAmount = Number(amount);

  if (!Number.isSafeInteger(paymentAmount) || paymentAmount < 1) {
    return res.status(400).json({
      success: false,
      message: "Enter a valid whole-number amount of at least KSh 1."
    });
  }

  let phone = String(phoneNumber || "").replace(/[\s+-]/g, "");

  if (/^0[17]\d{8}$/.test(phone)) {
    phone = `254${phone.slice(1)}`;
  }

  if (!/^254[17]\d{8}$/.test(phone)) {
    return res.status(400).json({
      success: false,
      message: "Enter a valid Kenyan mobile number."
    });
  }

  const allowedGivingTypes = [
    "Tithe",
    "Offering",
    "Thanksgiving",
    "Missions",
    "Other"
  ];

  const selectedGivingType = allowedGivingTypes.includes(givingType)
    ? givingType
    : "Offering";

  const consumerKey = process.env.DARAJA_CONSUMER_KEY;
  const consumerSecret = process.env.DARAJA_CONSUMER_SECRET;
  const shortcode = process.env.DARAJA_SHORTCODE;
  const passkey = process.env.DARAJA_PASSKEY;
  const callbackUrl = process.env.DARAJA_CALLBACK_URL;

  if (!consumerKey || !consumerSecret || !shortcode || !passkey) {
    return res.status(500).json({
      success: false,
      message: "Daraja sandbox configuration is incomplete."
    });
  }

  if (
    !callbackUrl ||
    !callbackUrl.startsWith("https://")
  ) {
    return res.status(500).json({
      success: false,
      message: "Configure a publicly reachable HTTPS callback URL."
    });
  }

  try {
    // Obtain a Daraja access token.
    const credentials = Buffer.from(
      `${consumerKey}:${consumerSecret}`
    ).toString("base64");

    const tokenResponse = await fetch(
      "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        headers: {
          Authorization: `Basic ${credentials}`
        }
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error(
        "Daraja token request failed. HTTP status:",
        tokenResponse.status
      );

      return res.status(502).json({
        success: false,
        message: "Could not authenticate with Daraja Sandbox."
      });
    }

    // Generate the timestamp and STK Push password.
    const now = new Date();

    const timestamp =
      now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0") +
      String(now.getHours()).padStart(2, "0") +
      String(now.getMinutes()).padStart(2, "0") +
      String(now.getSeconds()).padStart(2, "0");

    const password = Buffer.from(
      `${shortcode}${passkey}${timestamp}`
    ).toString("base64");

    const stkPayload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: paymentAmount,
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: "PEFA-GIVING",
      TransactionDesc: `Church ${selectedGivingType}`.slice(0, 13)
    };

    // Submit the STK Push request to Daraja Sandbox.
    const stkResponse = await fetch(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(stkPayload)
      }
    );

    const stkData = await stkResponse.json();

    if (!stkResponse.ok || stkData.ResponseCode !== "0") {
      console.error(
        "Daraja STK Push request rejected:",
        stkData.errorCode ||
          stkData.ResponseCode ||
          stkResponse.status
      );

      return res.status(502).json({
        success: false,
        message: "Daraja did not accept the STK Push request."
      });
    }

    // Record the accepted request as pending.
    // Never mark it paid just because STK Push was accepted.
    db.prepare(`
      INSERT INTO donations (
        checkout_request_id,
        merchant_request_id,
        phone_number,
        amount,
        giving_type,
        status
      )
      VALUES (?, ?, ?, ?, ?, 'pending')
    `).run(
      stkData.CheckoutRequestID,
      stkData.MerchantRequestID || null,
      phone,
      paymentAmount,
      selectedGivingType
    );

    return res.status(200).json({
      success: true,
      message:
        "Daraja accepted the sandbox request. This does not confirm payment.",
      checkoutRequestId: stkData.CheckoutRequestID,
      merchantRequestId: stkData.MerchantRequestID,
      responseDescription: stkData.ResponseDescription
    });
  } catch (error) {
    console.error("STK Push processing error:", error.message);

    return res.status(502).json({
      success: false,
      message: "Could not complete the Daraja Sandbox request."
    });
  }
});

// 5. Daraja callback receiver
// Callback processing is handled by the tested mpesa-callback.js module.
app.post("/api/giving/callback", (req, res) => {
  try {
    const result = processCallback(db, req.body);

    if (result.httpStatus >= 400) {
      console.warn("Rejected callback:", result.ResultDesc);
    }

    return res.status(result.httpStatus).json({
      ResultCode: result.ResultCode,
      ResultDesc: result.ResultDesc
    });
  } catch (error) {
    console.error(
      "Could not process donation callback:",
      error.message
    );

    return res.status(500).json({
      ResultCode: 1,
      ResultDesc: "Could not process callback."
    });
  }
});

// Start the backend.
app.listen(PORT, "0.0.0.0", () => {
  console.log(`PEFA Lighthouse backend running on port ${PORT}`);
});
