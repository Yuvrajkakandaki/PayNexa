import mongoose from "mongoose";
import { AppError } from "../errors/AppError.js";

/**
 * Central error-handling middleware.
 *
 * Express recognises a 4-argument middleware (err, req, res, next) as the
 * error handler. It must be registered AFTER all routes.
 *
 * Error classification (in priority order):
 *  1. AppError  — we threw it ourselves with a known status + safe message
 *  2. Mongoose validation / cast / duplicate-key — map to 400/409
 *  3. Gemini quota / auth — map to 502/503
 *  4. PayPal API error  — map to 502 with PayPal's own reason (no secrets)
 *  5. MongoDB connection error — map to 503
 *  6. Everything else  — 500 with a generic message
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // Always log the full error on the server for debugging
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.url} —`, err);

  const isProd = process.env.NODE_ENV === "production";

  // ── 1. Our own AppError ────────────────────────────────────────────────────
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
      // In development, include the stack so engineers can trace it quickly
      ...(isProd ? {} : { stack: err.stack }),
    });
  }

  // ── 2. Mongoose errors ─────────────────────────────────────────────────────

  // Validation failed (e.g. schema constraints)
  if (err.name === "ValidationError") {
    const messages = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({ error: messages.join(" ") });
  }

  // Invalid schema type cast (e.g. /api/invoices/not-an-id or invalid query cast)
  if (err.name === "CastError") {
    return res.status(400).json({ error: err.kind === "ObjectId" ? "Invalid ID format." : "Invalid request data format." });
  }

  // Duplicate unique-index key
  if (err.code === 11000) {
    return res.status(409).json({ error: "A duplicate record was detected." });
  }

  // MongoDB not connected / network timeout
  if (
    err.name === "MongoNetworkError" ||
    err.name === "MongoServerSelectionError" ||
    err instanceof mongoose.mongo.MongoNetworkError
  ) {
    return res.status(503).json({
      error: "The database is temporarily unavailable. Please try again shortly.",
    });
  }

  // ── 3. Gemini / Google API errors ─────────────────────────────────────────
  // The @google/genai SDK throws errors whose message contains status codes.
  // We look for quota (429) and auth (401/403) signals.
  if (err.message) {
    const msg = err.message.toLowerCase();

    if (msg.includes("quota") || msg.includes("rate limit") || msg.includes("429")) {
      return res.status(503).json({
        error: "The AI service is temporarily over its usage limit. Please try again in a moment.",
      });
    }

    if (
      msg.includes("api_key") ||
      msg.includes("api key") ||
      msg.includes("invalid key") ||
      msg.includes("401") ||
      msg.includes("403")
    ) {
      return res.status(502).json({
        error: "The AI service rejected the request. Please contact the administrator.",
      });
    }

    // ── 4. PayPal API errors ───────────────────────────────────────────────
    // paypal.js throws errors like:
    //   "PayPal API error (401): {...}"
    //   "PayPal authentication failed (401): invalid_client"
    // We extract the PayPal reason but never expose our credentials.
    if (
      msg.includes("paypal api") ||
      msg.includes("paypal auth") ||
      msg.includes("paypal request") ||
      msg.includes("paypal returned") ||
      msg.includes("paypal webhook") ||
      msg.startsWith("paypal")
    ) {
      // Try to pull the human-readable reason from the message
      const reasonMatch = err.message.match(/:\s*(.+)$/);
      const reason = reasonMatch ? reasonMatch[1].trim() : "Unknown PayPal error.";

      // Truncate to 200 chars so we don't accidentally leak a full token dump
      const safeReason = reason.slice(0, 200);

      return res.status(502).json({
        error: `PayPal rejected the request: ${safeReason}`,
      });
    }
  }

  // ── 5. Catch-all ──────────────────────────────────────────────────────────
  // Never send stack traces or internal messages to clients in production.
  return res.status(500).json({
    error: "An unexpected error occurred. Please try again later.",
    ...(isProd ? {} : { detail: err.message, stack: err.stack }),
  });
}
