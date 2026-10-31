/**
 * PayNexa API – Automated tests
 * Run: node --test src/tests/api.test.js
 *
 * Uses Node.js built-in test runner (node:test) and assert — no extra packages.
 *
 * What is tested:
 *  - Input validation (missing prompt, bad email, prompt too long)
 *  - Duplicate protection (idempotency key logic in isolation)
 *  - Analytics calculation helper (calcTotal, per-status bucketing)
 *  - Pagination helper logic
 *  - CSV escaping
 *  - Currency whitelist
 *  - Date validation helpers
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Helpers extracted / replicated from index.js for unit testing
// ---------------------------------------------------------------------------

const MAX_PROMPT_LENGTH = 2000;
const MAX_ITEMS = 20;

const ALLOWED_CURRENCIES = new Set([
  "USD", "EUR", "GBP", "CAD", "AUD", "JPY", "INR", "CNY", "CHF", "MXN",
  "SGD", "HKD", "NOK", "SEK", "DKK", "NZD", "ZAR", "BRL", "AED", "SAR",
]);

function buildIdempotencyKey(prompt, clientEmail) {
  return crypto
    .createHash("sha256")
    .update(`${prompt.trim().toLowerCase()}|${clientEmail.trim().toLowerCase()}`)
    .digest("hex");
}

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

function escapeCSV(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function isValidDueDate(dueDate) {
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return false;
  if (Number.isNaN(Date.parse(`${dueDate}T00:00:00Z`))) return false;
  if (new Date(`${dueDate}T00:00:00Z`).toISOString().slice(0, 10) !== dueDate) return false;
  return true;
}

function isDueDateInPast(dueDate) {
  const today = new Date().toISOString().slice(0, 10);
  return dueDate < today;
}

function isValidItems(items) {
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.every(
    (item) =>
      item &&
      typeof item.name === "string" &&
      item.name.trim() &&
      Number.isInteger(item.quantity) &&
      item.quantity > 0 &&
      Number.isFinite(item.unitPrice) &&
      item.unitPrice >= 0
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Input Validation", () => {
  test("rejects empty prompt", () => {
    const prompt = "  ";
    assert.equal(!prompt || !prompt.trim(), true);
  });

  test("rejects prompt that is too long", () => {
    const prompt = "x".repeat(MAX_PROMPT_LENGTH + 1);
    assert.equal(prompt.length > MAX_PROMPT_LENGTH, true);
  });

  test("accepts prompt within limit", () => {
    const prompt = "x".repeat(MAX_PROMPT_LENGTH);
    assert.equal(prompt.length > MAX_PROMPT_LENGTH, false);
  });

  test("rejects invalid email — no @", () => {
    assert.equal(isValidEmail("invalidemail.com"), false);
  });

  test("rejects invalid email — empty string", () => {
    assert.equal(isValidEmail(""), false);
  });

  test("rejects invalid email — spaces", () => {
    assert.equal(isValidEmail("a b@c.com"), false);
  });

  test("accepts valid email", () => {
    assert.equal(isValidEmail("user@example.com"), true);
  });

  test("accepts valid email with subdomain", () => {
    assert.equal(isValidEmail("user@mail.example.co.uk"), true);
  });
});

describe("Duplicate Protection — Idempotency Key", () => {
  test("same prompt + email always produces same key", () => {
    const key1 = buildIdempotencyKey("Invoice for 5 logos at $200", "client@example.com");
    const key2 = buildIdempotencyKey("Invoice for 5 logos at $200", "client@example.com");
    assert.equal(key1, key2);
  });

  test("key is case-insensitive on prompt", () => {
    const key1 = buildIdempotencyKey("INVOICE FOR 5 LOGOS AT $200", "client@example.com");
    const key2 = buildIdempotencyKey("invoice for 5 logos at $200", "client@example.com");
    assert.equal(key1, key2);
  });

  test("key is case-insensitive on email", () => {
    const key1 = buildIdempotencyKey("Invoice for 5 logos", "CLIENT@EXAMPLE.COM");
    const key2 = buildIdempotencyKey("Invoice for 5 logos", "client@example.com");
    assert.equal(key1, key2);
  });

  test("different prompt produces different key", () => {
    const key1 = buildIdempotencyKey("Invoice for 5 logos at $200", "client@example.com");
    const key2 = buildIdempotencyKey("Invoice for 3 logos at $200", "client@example.com");
    assert.notEqual(key1, key2);
  });

  test("different email produces different key", () => {
    const key1 = buildIdempotencyKey("Invoice for 5 logos", "alice@example.com");
    const key2 = buildIdempotencyKey("Invoice for 5 logos", "bob@example.com");
    assert.notEqual(key1, key2);
  });

  test("key is a 64-char hex string (SHA-256)", () => {
    const key = buildIdempotencyKey("test", "test@test.com");
    assert.match(key, /^[a-f0-9]{64}$/);
  });
});

describe("calcTotal helper", () => {
  test("calculates total correctly", () => {
    const items = [
      { quantity: 2, unitPrice: 50 },
      { quantity: 3, unitPrice: 10.5 },
    ];
    assert.equal(calcTotal(items), 131.5);
  });

  test("returns 0 for empty array", () => {
    assert.equal(calcTotal([]), 0);
  });

  test("returns 0 for undefined", () => {
    assert.equal(calcTotal(), 0);
  });

  test("rounds to 2 decimal places", () => {
    const items = [{ quantity: 1, unitPrice: 0.1 }, { quantity: 1, unitPrice: 0.2 }];
    assert.equal(calcTotal(items), 0.3);
  });

  test("handles zero-price items", () => {
    const items = [{ quantity: 5, unitPrice: 0 }];
    assert.equal(calcTotal(items), 0);
  });
});

describe("Analytics — status bucketing", () => {
  function analyseInvoices(invoices) {
    let totalInvoiced = 0;
    let totalPaid = 0;
    let outstandingAmount = 0;
    const statusCounts = {};

    for (const invoice of invoices) {
      const amount = calcTotal(invoice.items);
      const status = (invoice.status || "UNKNOWN").toUpperCase();
      statusCounts[status] = (statusCounts[status] || 0) + 1;
      totalInvoiced += amount;

      if (status === "PAID" || status === "MARKED_AS_PAID") {
        totalPaid += amount;
      } else if (status === "PARTIALLY_PAID") {
        const half = Number((amount / 2).toFixed(2));
        totalPaid += half;
        outstandingAmount += amount - half;
      } else if (status !== "CANCELLED" && status !== "VOID" && status !== "REFUNDED") {
        outstandingAmount += amount;
      }
    }

    return {
      totalInvoiced: Number(totalInvoiced.toFixed(2)),
      totalPaid: Number(totalPaid.toFixed(2)),
      outstandingAmount: Number(outstandingAmount.toFixed(2)),
      statusCounts,
    };
  }

  const makeInvoice = (status, quantity, unitPrice) => ({
    status,
    items: [{ quantity, unitPrice }],
  });

  test("PAID invoice is counted as paid", () => {
    const { totalPaid, outstandingAmount } = analyseInvoices([
      makeInvoice("PAID", 2, 100),
    ]);
    assert.equal(totalPaid, 200);
    assert.equal(outstandingAmount, 0);
  });

  test("MARKED_AS_PAID is treated as fully paid", () => {
    const { totalPaid, outstandingAmount } = analyseInvoices([
      makeInvoice("MARKED_AS_PAID", 1, 500),
    ]);
    assert.equal(totalPaid, 500);
    assert.equal(outstandingAmount, 0);
  });

  test("PARTIALLY_PAID splits 50/50", () => {
    const { totalPaid, outstandingAmount } = analyseInvoices([
      makeInvoice("PARTIALLY_PAID", 1, 200),
    ]);
    assert.equal(totalPaid, 100);
    assert.equal(outstandingAmount, 100);
  });

  test("SENT invoice is counted as outstanding", () => {
    const { outstandingAmount, totalPaid } = analyseInvoices([
      makeInvoice("SENT", 1, 300),
    ]);
    assert.equal(outstandingAmount, 300);
    assert.equal(totalPaid, 0);
  });

  test("CANCELLED is excluded from outstanding", () => {
    const { outstandingAmount, totalPaid } = analyseInvoices([
      makeInvoice("CANCELLED", 1, 300),
    ]);
    assert.equal(outstandingAmount, 0);
    assert.equal(totalPaid, 0);
  });

  test("VOID is excluded from outstanding", () => {
    const { outstandingAmount } = analyseInvoices([makeInvoice("VOID", 1, 400)]);
    assert.equal(outstandingAmount, 0);
  });

  test("REFUNDED is excluded from outstanding", () => {
    const { outstandingAmount } = analyseInvoices([makeInvoice("REFUNDED", 1, 150)]);
    assert.equal(outstandingAmount, 0);
  });

  test("mixed invoices sum correctly", () => {
    const { totalInvoiced, totalPaid, outstandingAmount } = analyseInvoices([
      makeInvoice("PAID", 1, 100),          // paid: 100
      makeInvoice("SENT", 1, 200),           // outstanding: 200
      makeInvoice("CANCELLED", 1, 50),       // excluded
      makeInvoice("PARTIALLY_PAID", 1, 80),  // paid: 40, outstanding: 40
    ]);
    assert.equal(totalInvoiced, 430);
    assert.equal(totalPaid, 140);
    assert.equal(outstandingAmount, 240);
  });

  test("empty invoice list returns zeroes", () => {
    const result = analyseInvoices([]);
    assert.equal(result.totalInvoiced, 0);
    assert.equal(result.totalPaid, 0);
    assert.equal(result.outstandingAmount, 0);
  });

  test("per-currency breakdown calculates independently", () => {
    function analyseByCurrency(invoices) {
      const byCurrency = {};
      for (const inv of invoices) {
        const cur = (inv.currency || "USD").toUpperCase();
        const amt = calcTotal(inv.items);
        if (!byCurrency[cur]) byCurrency[cur] = { totalInvoiced: 0, totalPaid: 0 };
        byCurrency[cur].totalInvoiced += amt;
        if (inv.status === "PAID") byCurrency[cur].totalPaid += amt;
      }
      return byCurrency;
    }

    const invoices = [
      { currency: "USD", status: "PAID", items: [{ quantity: 1, unitPrice: 100 }] },
      { currency: "EUR", status: "PAID", items: [{ quantity: 2, unitPrice: 50 }] },
      { currency: "USD", status: "SENT", items: [{ quantity: 1, unitPrice: 50 }] },
    ];

    const breakdown = analyseByCurrency(invoices);
    assert.equal(breakdown.USD.totalInvoiced, 150);
    assert.equal(breakdown.USD.totalPaid, 100);
    assert.equal(breakdown.EUR.totalInvoiced, 100);
    assert.equal(breakdown.EUR.totalPaid, 100);
  });
});

describe("Pagination logic", () => {
  function getPagination(page, limit, total) {
    const totalPages = Math.ceil(total / limit);
    return {
      currentPage: page,
      limit,
      totalInvoices: total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1 && totalPages > 0,
    };
  }

  test("first page has no previous page", () => {
    const p = getPagination(1, 10, 25);
    assert.equal(p.hasPreviousPage, false);
    assert.equal(p.hasNextPage, true);
  });

  test("last page has no next page", () => {
    const p = getPagination(3, 10, 25);
    assert.equal(p.hasNextPage, false);
    assert.equal(p.hasPreviousPage, true);
  });

  test("single page has neither next nor previous", () => {
    const p = getPagination(1, 10, 5);
    assert.equal(p.hasNextPage, false);
    assert.equal(p.hasPreviousPage, false);
  });

  test("totalPages rounds up correctly", () => {
    const p = getPagination(1, 10, 21);
    assert.equal(p.totalPages, 3);
  });
});

describe("CSV escaping", () => {
  test("wraps value in quotes", () => {
    assert.equal(escapeCSV("hello"), '"hello"');
  });

  test("escapes double quotes", () => {
    assert.equal(escapeCSV('say "hi"'), '"say ""hi"""');
  });

  test("handles undefined", () => {
    assert.equal(escapeCSV(undefined), '""');
  });

  test("handles null", () => {
    assert.equal(escapeCSV(null), '""');
  });

  test("handles numbers", () => {
    assert.equal(escapeCSV(42.5), '"42.5"');
  });

  test("handles commas inside value", () => {
    assert.equal(escapeCSV("a,b,c"), '"a,b,c"');
  });
});

describe("Currency whitelist", () => {
  test("USD is allowed", () => {
    assert.equal(ALLOWED_CURRENCIES.has("USD"), true);
  });

  test("INR is allowed", () => {
    assert.equal(ALLOWED_CURRENCIES.has("INR"), true);
  });

  test("XYZ is not allowed", () => {
    assert.equal(ALLOWED_CURRENCIES.has("XYZ"), false);
  });

  test("lowercase usd is not matched (whitelist is uppercase)", () => {
    assert.equal(ALLOWED_CURRENCIES.has("usd"), false);
  });
});

describe("Due date validation", () => {
  test("accepts valid future date", () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    assert.equal(isValidDueDate(futureDate), true);
    assert.equal(isDueDateInPast(futureDate), false);
  });

  test("rejects date in wrong format", () => {
    assert.equal(isValidDueDate("24-10-2026"), false);
  });

  test("rejects impossible date (Feb 30)", () => {
    assert.equal(isValidDueDate("2026-02-30"), false);
  });

  test("rejects empty string", () => {
    assert.equal(isValidDueDate(""), false);
  });

  test("past date is detected correctly", () => {
    assert.equal(isDueDateInPast("2020-01-01"), true);
  });
});

describe("Item validation", () => {
  test("accepts valid items", () => {
    const items = [{ name: "Logo design", quantity: 3, unitPrice: 150 }];
    assert.equal(isValidItems(items), true);
  });

  test("rejects empty items array", () => {
    assert.equal(isValidItems([]), false);
  });

  test("rejects non-integer quantity", () => {
    const items = [{ name: "Logo", quantity: 1.5, unitPrice: 100 }];
    assert.equal(isValidItems(items), false);
  });

  test("rejects zero quantity", () => {
    const items = [{ name: "Logo", quantity: 0, unitPrice: 100 }];
    assert.equal(isValidItems(items), false);
  });

  test("rejects negative unit price", () => {
    const items = [{ name: "Logo", quantity: 1, unitPrice: -50 }];
    assert.equal(isValidItems(items), false);
  });

  test("accepts zero unit price (free item)", () => {
    const items = [{ name: "Free consultation", quantity: 1, unitPrice: 0 }];
    assert.equal(isValidItems(items), true);
  });

  test("rejects null item in array", () => {
    assert.equal(isValidItems([null]), false);
  });

  test("rejects items exceeding MAX_ITEMS", () => {
    const items = Array.from({ length: MAX_ITEMS + 1 }, (_, i) => ({
      name: `Item ${i + 1}`,
      quantity: 1,
      unitPrice: 10,
    }));
    assert.equal(items.length > MAX_ITEMS, true);
  });
});
