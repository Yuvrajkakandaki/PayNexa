import express from "express";
import Invoice from "../models/Invoice.js";
import WebhookEvent from "../models/WebhookEvent.js";
import { verifyWebhookSignature } from "../paypal.js";
import { asyncWrap } from "../middleware/asyncWrap.js";

const router = express.Router();

/**
 * Map of PayPal event types to internal Invoice statuses
 */
export const EVENT_STATUS_MAP = {
  "INVOICING.INVOICE.PAID": "PAID",
  "INVOICING.INVOICE.MARKED_AS_PAID": "PAID",
  "INVOICING.INVOICE.CANCELLED": "CANCELLED",
  "INVOICING.INVOICE.REFUNDED": "REFUNDED",
  "INVOICING.INVOICE.SCHEDULED": "SCHEDULED",
};

/**
 * POST /api/webhooks/paypal
 * Receives asynchronous notifications from PayPal Sandbox / Live.
 */
router.post(
  "/paypal",
  asyncWrap(async (req, res) => {
    const event = req.body;

    if (!event || typeof event !== "object") {
      return res.status(400).json({ error: "Invalid webhook payload." });
    }

    const eventId = event.id;
    const eventType = event.event_type;
    const resource = event.resource;

    if (!eventId || !eventType) {
      return res.status(400).json({ error: "Missing event ID or event type." });
    }

    // 1. Idempotency Check (Task 2.4)
    // Avoid double-processing if PayPal retries delivery
    const alreadyProcessed = await WebhookEvent.findOne({ eventId });
    if (alreadyProcessed) {
      console.log(`[PayPal Webhook] Duplicate event ${eventId} safely ignored.`);
      return res.status(200).json({
        success: true,
        message: "Duplicate event already processed.",
        eventId,
      });
    }

    // 2. Cryptographic Signature Verification (Task 2.2)
    const isSignatureValid = await verifyWebhookSignature({
      headers: req.headers,
      rawBody: req.rawBody,
      body: event,
    });

    if (!isSignatureValid) {
      console.warn(`[PayPal Webhook] Signature verification failed for event ${eventId}.`);
      return res.status(401).json({ error: "Unauthorized webhook signature." });
    }

    // 3. Extract PayPal Invoice ID & Determine New Status (Task 2.3)
    const paypalInvoiceId = resource?.id || resource?.invoice?.id;
    let newStatus = EVENT_STATUS_MAP[eventType] || null;

    if (!newStatus && eventType === "INVOICING.INVOICE.UPDATED") {
      if (resource?.status) {
        newStatus = resource.status.toUpperCase();
      }
    }

    let updatedInvoice = null;

    if (paypalInvoiceId && newStatus) {
      updatedInvoice = await Invoice.findOneAndUpdate(
        { paypalInvoiceId },
        { $set: { status: newStatus } },
        { new: true }
      );

      if (updatedInvoice) {
        console.log(
          `[PayPal Webhook] Invoice ${paypalInvoiceId} status updated to ${newStatus}.`
        );
      } else {
        console.warn(
          `[PayPal Webhook] No invoice found matching paypalInvoiceId ${paypalInvoiceId}.`
        );
      }
    } else {
      console.log(`[PayPal Webhook] Event ${eventType} received without status update action.`);
    }

    // 4. Save event record to prevent duplicate processing
    await WebhookEvent.create({
      eventId,
      eventType,
      resourceId: paypalInvoiceId || "",
      status: newStatus || "UNMODIFIED",
    });

    return res.status(200).json({
      success: true,
      eventId,
      eventType,
      invoiceId: paypalInvoiceId,
      status: newStatus,
    });
  })
);

export default router;
