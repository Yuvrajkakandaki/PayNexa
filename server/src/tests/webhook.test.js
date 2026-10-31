import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EVENT_STATUS_MAP } from "../routes/webhooks.js";
import { verifyWebhookSignature } from "../paypal.js";

describe("PayPal Webhooks — Event Mapping", () => {
  it("maps INVOICING.INVOICE.PAID to PAID", () => {
    assert.equal(EVENT_STATUS_MAP["INVOICING.INVOICE.PAID"], "PAID");
  });

  it("maps INVOICING.INVOICE.MARKED_AS_PAID to PAID", () => {
    assert.equal(EVENT_STATUS_MAP["INVOICING.INVOICE.MARKED_AS_PAID"], "PAID");
  });

  it("maps INVOICING.INVOICE.CANCELLED to CANCELLED", () => {
    assert.equal(EVENT_STATUS_MAP["INVOICING.INVOICE.CANCELLED"], "CANCELLED");
  });

  it("maps INVOICING.INVOICE.REFUNDED to REFUNDED", () => {
    assert.equal(EVENT_STATUS_MAP["INVOICING.INVOICE.REFUNDED"], "REFUNDED");
  });

  it("returns undefined for unknown or unhandled event types", () => {
    assert.equal(EVENT_STATUS_MAP["UNKNOWN.EVENT.TYPE"], undefined);
    assert.equal(EVENT_STATUS_MAP["CUSTOMER.DISPUTE.CREATED"], undefined);
  });
});

describe("PayPal Webhooks — Resource Extraction", () => {
  function extractInvoiceId(resource) {
    return resource?.id || resource?.invoice?.id || null;
  }

  it("extracts ID from standard resource.id", () => {
    const resource = { id: "INV2-ABCD-1234", status: "PAID" };
    assert.equal(extractInvoiceId(resource), "INV2-ABCD-1234");
  });

  it("extracts ID from nested resource.invoice.id", () => {
    const resource = { invoice: { id: "INV2-XYZ-9999" } };
    assert.equal(extractInvoiceId(resource), "INV2-XYZ-9999");
  });

  it("returns null if neither is present", () => {
    assert.equal(extractInvoiceId({}), null);
    assert.equal(extractInvoiceId(null), null);
  });
});

describe("PayPal Webhooks — Signature Verification Headers", () => {
  it("skips verification gracefully if PAYPAL_WEBHOOK_ID is not configured", async () => {
    const verified = await verifyWebhookSignature({
      headers: {},
      rawBody: "{}",
      body: {},
      webhookId: "",
    });
    assert.equal(verified, true);
  });

  it("rejects verification if headers are missing when webhookId is provided", async () => {
    const verified = await verifyWebhookSignature({
      headers: {},
      rawBody: "{}",
      body: {},
      webhookId: "WH-12345",
    });
    assert.equal(verified, false);
  });

  it("detects when partial headers are supplied", async () => {
    const verified = await verifyWebhookSignature({
      headers: {
        "paypal-transmission-id": "trans-1",
        "paypal-transmission-time": "2026-10-31T00:00:00Z",
        // missing cert-url, auth-algo, transmission-sig
      },
      rawBody: "{}",
      body: {},
      webhookId: "WH-12345",
    });
    assert.equal(verified, false);
  });
});
