
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts. Please try again in 15 minutes.",
  },
});

router.post("/login", loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      username.length > 100 ||
      password.length > 200
    ) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid username and password.",
      });
    }

    const expectedUsername = process.env.ADMIN_USERNAME;
    const passwordHash = process.env.ADMIN_PASSWORD_HASH;
    const jwtSecret = process.env.JWT_SECRET;

    if (!expectedUsername || !passwordHash || !jwtSecret) {
      console.error("Admin login configuration is incomplete.");
      return res.status(503).json({
        success: false,
        message: "Admin login is not configured.",
      });
    }

    const usernameMatches = username === expectedUsername;
    const passwordMatches = await bcrypt.compare(password, passwordHash);

    if (!usernameMatches || !passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password.",
      });
    }

    const token = jwt.sign(
      { role: "admin" },
      jwtSecret,
      {
        expiresIn: "30m",
        issuer: "pefa-lighthouse-backend",
        audience: "pefa-admin",
      }
    );

    return res.json({
      success: true,
      message: "Admin login successful.",
      token,
      expiresIn: 1800,
    });
  } catch (error) {
    console.error("Admin login error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to sign in right now.",
    });
  }
});

function requireAdmin(req, res, next) {
  const authorization = req.headers.authorization;

  if (
    typeof authorization !== "string" ||
    !authorization.startsWith("Bearer ")
  ) {
    return res.status(401).json({
      success: false,
      message: "Admin authentication required.",
    });
  }

  const token = authorization.slice(7);
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    return res.status(503).json({
      success: false,
      message: "Admin authentication is not configured.",
    });
  }

  try {
    const payload = jwt.verify(token, jwtSecret, {
      issuer: "pefa-lighthouse-backend",
      audience: "pefa-admin",
    });

    if (payload.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Admin access denied.",
      });
    }

    req.admin = payload;
    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Your admin session is invalid or expired. Please sign in again.",
    });
  }
}

module.exports = {
  router,
  requireAdmin,
};
