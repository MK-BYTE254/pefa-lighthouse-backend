
require("dotenv").config();

const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "100kb" }));

// 1. Basic health check
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "PEFA Lighthouse backend is running!"
  });
});

// 2. Giving service status
// Keep payments disabled until the full payment flow is tested.
app.get("/api/giving/status", (req, res) => {
  res.json({
    success: true,
    message: "Giving service is online.",
    paymentsEnabled: false
  });
});

// 3. Test Daraja Sandbox authentication
// This route does not initiate a payment.
app.get("/api/daraja/test-token", async (req, res) => {
  const consumerKey = process.env.DARAJA_CONSUMER_KEY;
  const consumerSecret = process.env.DARAJA_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    return res.status(500).json({
      success: false,
      message: "Daraja credentials are missing from backend configuration."
    });
  }

  if (process.env.DARAJA_ENV !== "sandbox") {
    return res.status(400).json({
      success: false,
      message: "This test route is restricted to sandbox mode."
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
        message: "Daraja authentication failed. Check your sandbox credentials."
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
      message: "Could not connect to Daraja. Check your internet connection."
    });
  }
});

// 4. STK Push request — Sandbox only
app.post("/api/mpesa/stk-push", async (req, res) => {
  const { amount, phoneNumber, givingType } = req.body || {};
  const paymentAmount = Number(amount);

  // Validate amount
  if (!Number.isSafeInteger(paymentAmount) || paymentAmount < 1) {
    return res.status(400).json({
      success: false,
      message: "Enter a valid whole-number amount of at least KSh 1."
    });
  }

  // Normalize Kenyan mobile numbers to 254 format
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

  // Never use this endpoint for production payments.
  if (process.env.DARAJA_ENV !== "sandbox") {
    return res.status(400).json({
      success: false,
      message: "This endpoint is restricted to Daraja Sandbox mode."
    });
  }

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

  if (!callbackUrl || !callbackUrl.startsWith("https://")) {
    return res.status(500).json({
      success: false,
      message: "Configure a public HTTPS callback URL before testing STK Push."
    });
  }

  try {
    // Obtain Daraja access token
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
        "Daraja authentication failed. HTTP status:",
        tokenResponse.status
      );

      return res.status(502).json({
        success: false,
        message: "Could not authenticate with Daraja Sandbox."
      });
    }

    // Generate timestamp in YYYYMMDDHHmmss format
    const now = new Date();

    const timestamp =
      now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0") +
      String(now.getHours()).padStart(2, "0") +
      String(now.getMinutes()).padStart(2, "0") +
      String(now.getSeconds()).padStart(2, "0");

    // Generate the STK Push password
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

    // Send STK Push request to Daraja Sandbox
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
        message: "Daraja did not accept the STK Push request. Check the sandbox configuration."
      });
    }

    // Request accepted does not mean payment completed.
    return res.status(200).json({
      success: true,
      message: "Daraja accepted the sandbox STK Push request. This does not confirm payment.",
      checkoutRequestId: stkData.CheckoutRequestID,
      merchantRequestId: stkData.MerchantRequestID,
      responseDescription: stkData.ResponseDescription
    });
  } catch (error) {
    console.error("STK Push connection error:", error.message);

    return res.status(502).json({
      success: false,
      message: "Could not complete the Daraja Sandbox request."
    });
  }
});

// 5. Initial Daraja callback receiver
// This acknowledges callbacks but does not save payment records.
app.post("/api/mpesa/callback", (req, res) => {
  const callback = req.body?.Body?.stkCallback;

  if (!callback) {
    console.warn("Received an unexpected M-Pesa callback payload.");

    return res.status(400).json({
      ResultCode: 1,
      ResultDesc: "Invalid callback payload."
    });
  }

  console.log("Daraja callback received:", {
    resultCode: callback.ResultCode,
    checkoutRequestId: callback.CheckoutRequestID || null,
    merchantRequestId: callback.MerchantRequestID || null,
    resultDescription: callback.ResultDesc || "No description provided"
  });

  // Database persistence and payment reconciliation are still required.
  return res.status(200).json({
    ResultCode: 0,
    ResultDesc: "Callback received."
  });
});

// Start the server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`PEFA Lighthouse backend running on port ${PORT}`);
});
