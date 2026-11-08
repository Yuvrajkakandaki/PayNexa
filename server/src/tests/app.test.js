/**
 * Route-level tests against the real Express app (imported from index.js).
 * Only paths that finish before touching MongoDB / Gemini / PayPal are covered,
 * so no external services or credentials are needed.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import jwt from "jsonwebtoken";

// Must be set BEFORE index.js is imported (it reads env at load time).
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test_jwt_secret_with_at_least_32_characters_ok";
process.env.GEMINI_API_KEY = "dummy_gemini_key_for_tests";

let app;
let token;

before(async () => {
  ({ app } = await import("../index.js"));
  token = jwt.sign(
    { userId: "64b7f0c2a1b2c3d4e5f60718", email: "test@example.com" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
});

const auth = () => ({ Authorization: `Bearer ${token}` });

describe("Health", () => {
  it("GET /api/health returns ok", async () => {
    const res = await request(app).get("/api/health");
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
  });
});

describe("Authentication guard", () => {
  for (const [method, path] of [
    ["get", "/api/invoices"],
    ["get", "/api/analytics"],
    ["get", "/api/invoices/export/csv"],
    ["post", "/api/parse"],
    ["post", "/api/invoices"],
    ["post", "/api/invoices/sync"],
  ]) {
    it(`${method.toUpperCase()} ${path} rejects requests without a token`, async () => {
      const res = await request(app)[method](path).send({});
      assert.equal(res.status, 401);
    });
  }

  it("rejects a token signed with a different secret", async () => {
    const forged = jwt.sign({ userId: "abc", email: "x@y.com" }, "some_other_secret_that_is_long_enough_123");
    const res = await request(app).get("/api/invoices").set("Authorization", `Bearer ${forged}`);
    assert.equal(res.status, 401);
  });

  it("rejects an expired token", async () => {
    const expired = jwt.sign({ userId: "abc", email: "x@y.com" }, process.env.JWT_SECRET, { expiresIn: "-5s" });
    const res = await request(app).get("/api/invoices").set("Authorization", `Bearer ${expired}`);
    assert.equal(res.status, 401);
  });
});

describe("POST /api/parse validation", () => {
  it("400 when prompt is missing", async () => {
    const res = await request(app).post("/api/parse").set(auth()).send({});
    assert.equal(res.status, 400);
  });

  it("400 when prompt exceeds 500 characters", async () => {
    const res = await request(app).post("/api/parse").set(auth()).send({ prompt: "a".repeat(501) });
    assert.equal(res.status, 400);
  });
});

describe("POST /api/invoices validation", () => {
  const valid = { prompt: "Logo design for Acme, $500", clientEmail: "client@example.com", requestId: "req-1" };

  it("400 when prompt is missing", async () => {
    const res = await request(app).post("/api/invoices").set(auth()).send({ ...valid, prompt: "" });
    assert.equal(res.status, 400);
  });

  it("400 when prompt exceeds 2000 characters", async () => {
    const res = await request(app).post("/api/invoices").set(auth()).send({ ...valid, prompt: "a".repeat(2001) });
    assert.equal(res.status, 400);
  });

  it("400 when clientEmail is invalid", async () => {
    const res = await request(app).post("/api/invoices").set(auth()).send({ ...valid, clientEmail: "not-an-email" });
    assert.equal(res.status, 400);
  });

  it("400 when requestId is missing", async () => {
    const res = await request(app).post("/api/invoices").set(auth()).send({ ...valid, requestId: "" });
    assert.equal(res.status, 400);
  });
});

describe("GET /api/invoices/:id validation", () => {
  it("400 for a malformed invoice id", async () => {
    const res = await request(app).get("/api/invoices/not-an-id").set(auth());
    assert.equal(res.status, 400);
  });
});

describe("Auth routes validation", () => {
  it("register returns 400 for an invalid email", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "Test", email: "bad", password: "password123" });
    assert.equal(res.status, 400);
  });

  it("login returns 400 when the password is missing", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "a@b.com" });
    assert.equal(res.status, 400);
  });
});

describe("Webhook endpoint", () => {
  it("400 when the payload has no event id / type", async () => {
    const res = await request(app).post("/api/webhooks/paypal").send({});
    assert.equal(res.status, 400);
  });
});

describe("Security hardening", () => {
  it("getJwtSecret throws instead of falling back to a default", async () => {
    const { getJwtSecret } = await import("../middleware/authenticate.js");
    const saved = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    try {
      assert.throws(() => getJwtSecret(), /JWT_SECRET is not set/);
    } finally {
      process.env.JWT_SECRET = saved;
    }
  });

  it("webhook verification fails closed in production without PAYPAL_WEBHOOK_ID", async () => {
    const { verifyWebhookSignature } = await import("../paypal.js");
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const ok = await verifyWebhookSignature({ headers: {}, rawBody: "{}", body: {}, webhookId: undefined });
      assert.equal(ok, false);
    } finally {
      process.env.NODE_ENV = saved;
    }
  });

  it("validateConfig requires PAYPAL_WEBHOOK_ID in production", async () => {
    const { validateConfig } = await import("../config.js");
    const env = {
      NODE_ENV: "production",
      MONGODB_URI: "mongodb://localhost:27017/x",
      PAYPAL_CLIENT_ID: "id",
      PAYPAL_CLIENT_SECRET: "secret",
      PAYPAL_BASE_URL: "https://api-m.sandbox.paypal.com",
      GEMINI_API_KEY: "key",
      JWT_SECRET: "a".repeat(32),
    };
    assert.throws(() => validateConfig(env), /PAYPAL_WEBHOOK_ID is required in production/);
    assert.doesNotThrow(() => validateConfig({ ...env, PAYPAL_WEBHOOK_ID: "WH-123" }));
  });
});
