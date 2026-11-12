import crypto from "node:crypto";
import mongoose from "mongoose";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import { GoogleGenAI } from "@google/genai";

import {
  createDraftInvoice,
  sendInvoice,
  getInvoice,
  syncInvoiceStatus,
} from "./paypal.js";

import { connectDatabase } from "./database.js";
import Invoice from "./models/Invoice.js";

// Zod schema + validate() helper — single source of truth for invoice rules
import { aiInvoiceSchema, validate, MAX_PROMPT_LENGTH } from "./validation/invoiceSchema.js";

// Central error handling
import { AppError } from "./errors/AppError.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { asyncWrap } from "./middleware/asyncWrap.js";

// Webhook route
import webhookRoutes from "./routes/webhooks.js";

// Auth routes & middleware (Phase 3)
import authRoutes from "./routes/auth.js";
import { authenticate } from "./middleware/authenticate.js";

// Security & Logging (Phase 4)
import { requestLogger } from "./middleware/requestLogger.js";
import { validateConfig } from "./config.js";

dotenv.config();

// Validate required environment variables at boot
if (process.env.NODE_ENV !== "test") {
  try {
    validateConfig();
  } catch (err) {
    if (process.env.NODE_ENV === "production") {
      console.error("[Configuration Error]:", err.message);
      process.exit(1);
    }
    console.warn("⚠️ [Configuration Warning]:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Max characters allowed in the /api/parse prompt (Task 1)
const MAX_PARSE_PROMPT_LENGTH = 500;

// Gemini model name — defaults to gemini-3.5-flash-lite
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

// ObjectId is a 24-character hex string — used to validate :id route params
const OBJECT_ID_REGEX = /^[a-fA-F0-9]{24}$/;

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const app = express();
const PORT = process.env.PORT || 5000;

// Trust the first proxy in front of us (needed on Render, Railway, etc.)
// Without this, express-rate-limit reads the wrong IP from X-Forwarded-For.
app.set("trust proxy", 1);

// HTTP request logging (Task 4.1)
app.use(requestLogger);

// helmet sets many HTTP security headers in one call:
// X-Content-Type-Options, X-Frame-Options, HSTS, etc.
app.use(helmet());

// CORS — allow declared FRONTEND_URL as well as localhost / 127.0.0.1 on Vite ports
const configuredOrigin = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
const allowedOrigins = [
  configuredOrigin,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, server-to-server, Postman)
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes(origin.replace(/\/$/, ""))) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// Body size cap: reject JSON payloads larger than 10 KB.
// Verify callback saves the unparsed raw buffer to req.rawBody (required for PayPal signature verification)
app.use(
  express.json({
    limit: "10kb",
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

// General limit on all /api routes: 120 requests per minute per IP
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,   // sends RateLimit-* headers in the response
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});

// Stricter limit for the Gemini parse route: 20 per minute per IP.
// Parsing is an AI call — we want to protect our quota.
const parseLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many parse requests. Please wait before trying again." },
});

// Stricter limit for invoice creation: 10 per minute per IP.
// Creating an invoice calls Gemini + PayPal — very expensive.
const invoiceCreationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many invoice requests. Please wait before trying again." },
});

// Apply the general limiter to every /api/* route
app.use("/api", generalLimiter);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Calculates the total amount for an invoice items array.
 * Returns a number rounded to 2 decimal places.
 */
function calcTotal(items = []) {
  return Number(
    items
      .reduce(
        (sum, item) =>
          sum + Number(item.quantity || 0) * Number(item.unitPrice || 0),
        0
      )
      .toFixed(2)
  );
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Home route
app.get("/", (req, res) => {
  res.json({ message: "Welcome to PayNexa AI API!", status: "Running" });
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "PayNexa AI server is running" });
});

// PayPal Webhooks (Task 2.1)
app.use("/api/webhooks", webhookRoutes);

// Authentication Routes (Task 3.3)
app.use("/api/auth", authRoutes);

// ---------------------------------------------------------------------------
// Parse invoice using Gemini AI (preview — no PayPal call)
// parseLimiter applied here in addition to the general limiter.
// asyncWrap forwards any thrown / rejected error to the central error handler.
// ---------------------------------------------------------------------------
app.post(
  "/api/parse",
  authenticate,
  parseLimiter,
  asyncWrap(async (req, res) => {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      throw new AppError("Please provide an invoice description.", 400);
    }

    // Task 1: limit the parse prompt to 500 characters
    if (prompt.length > MAX_PARSE_PROMPT_LENGTH) {
      throw new AppError(
        `Invoice description is too long (max ${MAX_PARSE_PROMPT_LENGTH} characters).`,
        400
      );
    }

    // Call Gemini — if this throws, asyncWrap → errorHandler classifies it
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: `
        Extract invoice details from the user's request.

        Return only valid JSON:
        {
          "clientName": "string",
          "clientEmail": "string or empty string",
          "items": [
            {
              "name": "string",
              "quantity": 1,
              "unitPrice": 0
            }
          ],
          "currency": "USD",
          "dueDate": "YYYY-MM-DD"
        }

        Never invent a client email.
        Use the requested currency, or USD if unspecified.
        Today's date is ${new Date().toISOString().slice(0, 10)}.
        Calculate relative due dates correctly.
        Use numeric quantity and unitPrice values.

        Request: ${JSON.stringify(prompt)}
      `,
    });

    const text = response.text;

    if (!text) {
      throw new AppError("The AI returned an empty response.", 502);
    }

    const cleaned = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    let invoice;
    try {
      invoice = JSON.parse(cleaned);
    } catch {
      throw new AppError("The AI returned invalid JSON.", 502);
    }

    if (
      !invoice.clientName ||
      !Array.isArray(invoice.items) ||
      invoice.items.length === 0 ||
      !invoice.items.every(
        (item) =>
          typeof item.name === "string" &&
          item.name.trim() &&
          Number.isFinite(item.quantity) &&
          item.quantity > 0 &&
          Number.isFinite(item.unitPrice) &&
          item.unitPrice >= 0
      )
    ) {
      throw new AppError("The AI returned invalid invoice details.", 502);
    }

    return res.json({ success: true, invoice });
  })
);

// ---------------------------------------------------------------------------
// Create, send, and save invoice
// ---------------------------------------------------------------------------
app.post(
  "/api/invoices",
  authenticate,
  invoiceCreationLimiter,
  asyncWrap(async (req, res) => {
    // placeholder holds the MongoDB doc so we can mark it "failed" if PayPal errors
    let placeholder = null;

    const { prompt, clientEmail, requestId, parsedInvoice } = req.body;

    // --- Basic input validation (prompt + email) ---------------------------

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      throw new AppError("Please provide an invoice description.", 400);
    }

    if (prompt.length > MAX_PROMPT_LENGTH) {
      throw new AppError(
        `Invoice description is too long (max ${MAX_PROMPT_LENGTH} characters).`,
        400
      );
    }

    // clientEmail: valid email format
    if (
      typeof clientEmail !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail.trim())
    ) {
      throw new AppError("Please provide a valid customer email.", 400);
    }

    // requestId: must be a non-empty string (UUID from the frontend)
    if (!requestId || typeof requestId !== "string" || !requestId.trim()) {
      throw new AppError(
        "A requestId is required to prevent duplicate submissions.",
        400
      );
    }

    // --- Duplicate protection: check requestId before doing any work -------
    // If this requestId was already used, return the existing invoice immediately.
    // This handles double-clicks and accidental re-submissions.

    const existing = await Invoice.findOne({ requestId: requestId.trim(), userId: req.user.userId }).lean();

    if (existing) {
      // If it finished successfully, return it as if it just succeeded
      if (existing.status !== "CREATING" && existing.status !== "FAILED") {
        return res.status(200).json({
          success: true,
          message: "Invoice already exists (returned from cache).",
          invoiceId: existing.paypalInvoiceId,
          status: existing.status,
          invoice: {
            clientName: existing.clientName,
            clientEmail: existing.clientEmail,
            items: existing.items,
            currency: existing.currency,
            dueDate: existing.dueDate
              ? new Date(existing.dueDate).toISOString().slice(0, 10)
              : null,
            totalAmount: calcTotal(existing.items),
          },
        });
      }

      // If it is still "creating", another request is in progress
      if (existing.status === "CREATING") {
        throw new AppError(
          "This invoice is already being processed. Please wait.",
          409
        );
      }

      // If previous attempt "failed", the user must generate a new requestId
      if (existing.status === "FAILED") {
        throw new AppError(
          "A previous attempt with this request failed. Please refresh and try again.",
          409
        );
      }
    }

    // --- Phase 1: Write a placeholder to MongoDB BEFORE calling PayPal ----
    // This guarantees that even if PayPal fails, we have a record to update.
    // The unique index on requestId stops any racing duplicate from proceeding.

    placeholder = await Invoice.create({
      clientName: "(pending)",   // will be overwritten after Gemini responds
      clientEmail: clientEmail.trim(),
      items: [{ name: "(pending)", quantity: 1, unitPrice: 0.01 }], // temp
      currency: "USD",           // will be overwritten
      dueDate: new Date(),       // will be overwritten
      status: "creating",        // uppercase by Mongoose → "CREATING"
      requestId: requestId.trim(),
      userId: req.user.userId,
    });

    // --- Determine invoice details (edited preview or Gemini AI) -----------
    // Two paths:
    //  A) parsedInvoice provided → user edited the AI preview, skip Gemini
    //  B) no parsedInvoice       → call Gemini to extract from the prompt
    // Both paths validate through Zod before reaching PayPal.

    let details;

    if (parsedInvoice && typeof parsedInvoice === "object") {
      // ── Path A: User-provided pre-structured data (preview/edit flow) ──
      const userValidation = validate(aiInvoiceSchema, parsedInvoice);

      if (!userValidation.ok) {
        await Invoice.updateOne(
          { _id: placeholder._id },
          { $set: { status: "failed" } }
        );
        return res.status(400).json({
          error: "The provided invoice details failed validation.",
          details: userValidation.errors,
        });
      }

      details = userValidation.data;
    } else {
      // ── Path B: Ask Gemini to structure the invoice ──

      let aiResponse;

      try {
        aiResponse = await ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: `
            Extract invoice details from this request.
            Return ONLY valid JSON with no markdown:
            {
              "clientName": "string",
              "items": [
                { "name": "string", "quantity": 1, "unitPrice": 0 }
              ],
              "currency": "USD",
              "dueDate": "YYYY-MM-DD"
            }

            Today's date is ${new Date().toISOString().slice(0, 10)}.
            Calculate relative due dates correctly.
            Currency must be one of: USD, EUR, GBP. Default to USD.
            Do not invent contact information.
            unitPrice must be greater than 0.
            Request: ${JSON.stringify(prompt)}
          `,
        });
      } catch (error) {
        // Mark placeholder as failed so the user knows to retry
        await Invoice.updateOne(
          { _id: placeholder._id },
          { $set: { status: "failed" } }
        );
        // Re-throw — errorHandler will classify this as a Gemini error
        throw error;
      }

      const rawText = aiResponse.text;

      if (!rawText) {
        await Invoice.updateOne(
          { _id: placeholder._id },
          { $set: { status: "failed" } }
        );
        throw new AppError("The AI returned an empty response.", 502);
      }

      // Strip markdown code fences if Gemini wraps the JSON
      const cleaned = rawText
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();

      // Parse JSON from AI
      let rawDetails;
      try {
        rawDetails = JSON.parse(cleaned);
      } catch {
        await Invoice.updateOne(
          { _id: placeholder._id },
          { $set: { status: "failed" } }
        );
        throw new AppError(
          "The AI returned invalid JSON. Please rephrase your request.",
          502
        );
      }

      // --- Validate AI output with Zod -------------------------------------
      // AI output is untrusted — validate it with the same schema.

      const aiValidation = validate(aiInvoiceSchema, rawDetails);

      if (!aiValidation.ok) {
        await Invoice.updateOne(
          { _id: placeholder._id },
          { $set: { status: "failed" } }
        );
        return res.status(400).json({
          error: "The AI returned invoice details that failed validation.",
          details: aiValidation.errors,
        });
      }

      details = aiValidation.data;
    }

    // --- Create the PayPal draft invoice -----------------------------------

    let invoiceId;

    try {
      invoiceId = await createDraftInvoice({
        clientName: details.clientName,
        clientEmail: clientEmail.trim(),
        items: details.items,
        currency: details.currency,
        dueDate: details.dueDate,
      });
    } catch (error) {
      await Invoice.updateOne(
        { _id: placeholder._id },
        { $set: { status: "failed" } }
      );
      // Re-throw — errorHandler will detect "paypal" in the message
      throw error;
    }

    // --- Send the invoice through PayPal -----------------------------------

    try {
      await sendInvoice(invoiceId);
    } catch (error) {
      await Invoice.updateOne(
        { _id: placeholder._id },
        { $set: { status: "failed", paypalInvoiceId: invoiceId } }
      );
      throw error;
    }

    // --- Retrieve the final PayPal status ----------------------------------

    let paypalInvoice;
    try {
      paypalInvoice = await getInvoice(invoiceId);
    } catch (error) {
      console.error("PayPal getInvoice error (non-fatal):", error.message);
      paypalInvoice = { status: "SENT" }; // non-fatal, keep going
    }

    // --- Phase 2: Update the placeholder with real data --------------------
    // Replace the placeholder fields with what Gemini + PayPal returned.

    const finalStatus = paypalInvoice.status || "SENT";

    await Invoice.updateOne(
      { _id: placeholder._id },
      {
        $set: {
          clientName: details.clientName,
          items: details.items,
          currency: details.currency,
          dueDate: new Date(`${details.dueDate}T00:00:00.000Z`),
          paypalInvoiceId: invoiceId,
          status: finalStatus,
        },
      }
    );

    console.log("Invoice saved to MongoDB:", placeholder._id);

    // --- Return success ----------------------------------------------------

    return res.status(201).json({
      success: true,
      message: "Invoice created, sent, and saved successfully!",
      invoiceId,
      status: finalStatus,
      invoice: {
        clientName: details.clientName,
        clientEmail: clientEmail.trim(),
        items: details.items,
        currency: details.currency,
        dueDate: details.dueDate,
        totalAmount: calcTotal(details.items),
      },
    });
  })
);

// ---------------------------------------------------------------------------
// Retrieve saved invoice history with pagination
// ---------------------------------------------------------------------------
app.get(
  "/api/invoices",
  authenticate,
  asyncWrap(async (req, res) => {
    const parsedPage = Number.parseInt(req.query.page, 10);
    const parsedLimit = Number.parseInt(req.query.limit, 10);

    const page =
      Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;

    const requestedLimit =
      Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 10;

    // Maximum 100 invoices per request
    const limit = Math.min(requestedLimit, 100);
    const skip = (page - 1) * limit;

    const filter = { userId: req.user.userId };
    if (req.query.status && req.query.status !== "ALL") {
      filter.status = req.query.status.toUpperCase();
    }
    if (req.query.search && req.query.search.trim()) {
      const escaped = req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");
      filter.$or = [
        { clientName: regex },
        { clientEmail: regex },
        { paypalInvoiceId: regex },
      ];
    }

    const [invoices, totalInvoices] = await Promise.all([
      Invoice.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Invoice.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalInvoices / limit);

    return res.json({
      success: true,
      count: invoices.length,
      invoices,
      pagination: {
        currentPage: page,
        limit,
        totalInvoices,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1 && totalPages > 0,
      },
    });
  })
);

// ---------------------------------------------------------------------------
// Invoice analytics  (per-currency breakdown, PARTIALLY_PAID fix)
// ---------------------------------------------------------------------------
app.get(
  "/api/analytics",
  authenticate,
  asyncWrap(async (req, res) => {
    const invoices = await Invoice.find({ userId: req.user.userId }).lean();

    let totalInvoiced = 0;
    let totalPaid = 0;
    let outstandingAmount = 0;

    const statusCounts = {};
    const byCurrency = {};

    for (const invoice of invoices) {
      const amount = calcTotal(invoice.items);
      const status = (invoice.status || "UNKNOWN").toUpperCase();
      const currency = (invoice.currency || "USD").toUpperCase();

      // Status counts
      statusCounts[status] = (statusCounts[status] || 0) + 1;

      // Global totals
      totalInvoiced += amount;

      if (status === "PAID" || status === "MARKED_AS_PAID") {
        totalPaid += amount;
      } else if (status === "PARTIALLY_PAID") {
        // Best-effort: treat 50% as paid, 50% as outstanding
        const half = Number((amount / 2).toFixed(2));
        totalPaid += half;
        outstandingAmount += amount - half;
      } else if (status !== "CANCELLED" && status !== "VOID" && status !== "REFUNDED") {
        outstandingAmount += amount;
      }

      // Per-currency breakdown
      if (!byCurrency[currency]) {
        byCurrency[currency] = {
          totalInvoiced: 0,
          totalPaid: 0,
          outstandingAmount: 0,
          count: 0,
        };
      }

      byCurrency[currency].count += 1;
      byCurrency[currency].totalInvoiced += amount;

      if (status === "PAID" || status === "MARKED_AS_PAID") {
        byCurrency[currency].totalPaid += amount;
      } else if (status === "PARTIALLY_PAID") {
        const half = Number((amount / 2).toFixed(2));
        byCurrency[currency].totalPaid += half;
        byCurrency[currency].outstandingAmount += amount - half;
      } else if (status !== "CANCELLED" && status !== "VOID" && status !== "REFUNDED") {
        byCurrency[currency].outstandingAmount += amount;
      }
    }

    // Round all per-currency figures
    for (const cur of Object.keys(byCurrency)) {
      byCurrency[cur].totalInvoiced = Number(
        byCurrency[cur].totalInvoiced.toFixed(2)
      );
      byCurrency[cur].totalPaid = Number(byCurrency[cur].totalPaid.toFixed(2));
      byCurrency[cur].outstandingAmount = Number(
        byCurrency[cur].outstandingAmount.toFixed(2)
      );
    }

    return res.json({
      success: true,
      totalInvoices: invoices.length,
      totalInvoiced: Number(totalInvoiced.toFixed(2)),
      totalPaid: Number(totalPaid.toFixed(2)),
      outstandingAmount: Number(outstandingAmount.toFixed(2)),
      statusCounts,
      byCurrency,
    });
  })
);

// ---------------------------------------------------------------------------
// Synchronize saved invoice statuses with PayPal
// ---------------------------------------------------------------------------
app.post(
  "/api/invoices/sync",
  authenticate,
  asyncWrap(async (req, res) => {
    const invoices = await Invoice.find({
      userId: req.user.userId,
      paypalInvoiceId: { $exists: true, $nin: [null, ""] },
    }).lean();

    const results = [];
    let updated = 0;
    let failed = 0;

    for (const invoice of invoices) {
      try {
        const paypalData = await syncInvoiceStatus(invoice.paypalInvoiceId);

        await Invoice.updateOne(
          { _id: invoice._id },
          { $set: { status: paypalData.status } }
        );

        results.push({
          invoiceId: invoice.paypalInvoiceId,
          status: paypalData.status,
          success: true,
        });

        updated++;
      } catch (error) {
        results.push({
          invoiceId: invoice.paypalInvoiceId,
          success: false,
          error: error.message,
        });

        failed++;
      }
    }

    return res.json({
      success: true,
      total: invoices.length,
      updated,
      failed,
      results,
    });
  })
);

// ---------------------------------------------------------------------------
// Get details of a single invoice
// :id is validated as a MongoDB ObjectId before the DB call is made.
// ---------------------------------------------------------------------------
app.get(
  "/api/invoices/:id",
  authenticate,
  asyncWrap(async (req, res) => {
    const { id } = req.params;

    // Validate :id before passing it to Mongoose — avoids a CastError and
    // prevents passing arbitrary strings to the database layer.
    if (!OBJECT_ID_REGEX.test(id)) {
      throw new AppError("Invalid invoice ID format.", 400);
    }

    // mongoose.Types.ObjectId validates again at the driver level
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError("Invalid invoice ID format.", 400);
    }

    const invoice = await Invoice.findOne({ _id: id, userId: req.user.userId }).lean();

    if (!invoice) {
      throw new AppError("Invoice not found.", 404);
    }

    return res.json({
      success: true,
      invoice: {
        ...invoice,
        totalAmount: calcTotal(invoice.items),
      },
    });
  })
);

// ---------------------------------------------------------------------------
// Export invoice history as CSV
// ---------------------------------------------------------------------------
app.get(
  "/api/invoices/export/csv",
  authenticate,
  asyncWrap(async (req, res) => {
    const invoices = await Invoice.find({ userId: req.user.userId }).sort({ createdAt: -1 }).lean();

    // Escape CSV values safely
    function escapeCSV(value) {
      const text = String(value ?? "");
      return `"${text.replace(/"/g, '""')}"`;
    }

    const headers = [
      "Invoice ID",
      "Customer Name",
      "Customer Email",
      "Items",
      "Currency",
      "Total Amount",
      "Due Date",
      "Status",
      "Created At",
    ];

    const rows = invoices.map((invoice) => {
      const itemsDescription = (invoice.items || [])
        .map(
          (item) =>
            `${item.name} (Qty: ${item.quantity}, Unit Price: ${item.unitPrice})`
        )
        .join("; ");

      return [
        invoice.paypalInvoiceId,
        invoice.clientName,
        invoice.clientEmail,
        itemsDescription,
        invoice.currency,
        calcTotal(invoice.items),
        invoice.dueDate
          ? new Date(invoice.dueDate).toISOString().slice(0, 10)
          : "",
        invoice.status,
        invoice.createdAt ? new Date(invoice.createdAt).toISOString() : "",
      ];
    });

    const csv = [
      headers.map(escapeCSV).join(","),
      ...rows.map((row) => row.map(escapeCSV).join(",")),
    ].join("\r\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="paynexa-invoices.csv"'
    );

    // UTF-8 BOM helps Excel display text correctly
    return res.send("\uFEFF" + csv);
  })
);

// ---------------------------------------------------------------------------
// Central error handler — MUST be the last app.use() call.
// Express identifies it by the 4-argument signature (err, req, res, next).
// ---------------------------------------------------------------------------
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Start the server after connecting to MongoDB
// ---------------------------------------------------------------------------
async function startServer() {
  try {
    await connectDatabase();

    app.listen(PORT, () => {
      console.log(`PayNexa server running on port ${PORT}`);
      console.log(`CORS allowed origins: ${allowedOrigins.join(", ")}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error.message);
    process.exit(1);
  }
}

export { app };

// Only start listening when this file is run directly (not when imported by tests)
if (process.env.NODE_ENV !== "test") {
  startServer();
}