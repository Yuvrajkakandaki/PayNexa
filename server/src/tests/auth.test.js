import { describe, it } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { signToken, getJwtSecret, authenticate } from "../middleware/authenticate.js";

describe("Authentication — Password Hashing & Comparison", () => {
  it("hashes password with a random salt (different hashes for same input)", async () => {
    const password = "SecurePassword123!";
    const hash1 = await bcrypt.hash(password, 10);
    const hash2 = await bcrypt.hash(password, 10);

    assert.notEqual(hash1, hash2);
    assert.match(hash1, /^\$2[aby]\$/);
  });

  it("compares correct password successfully", async () => {
    const password = "MySecretPassword2026";
    const hash = await bcrypt.hash(password, 10);

    const matches = await bcrypt.compare(password, hash);
    assert.equal(matches, true);
  });

  it("rejects incorrect password", async () => {
    const password = "CorrectPassword1";
    const wrongPassword = "WrongPassword99";
    const hash = await bcrypt.hash(password, 10);

    const matches = await bcrypt.compare(wrongPassword, hash);
    assert.equal(matches, false);
  });
});

describe("Authentication — JWT Token Management", () => {
  it("generates a signed JWT with user payload", () => {
    const payload = { userId: "650c1234567890abcdef1234", email: "user@example.com" };
    const token = signToken(payload);

    assert.equal(typeof token, "string");
    assert.equal(token.split(".").length, 3); // Header.Payload.Signature

    const decoded = jwt.verify(token, getJwtSecret());
    assert.equal(decoded.userId, payload.userId);
    assert.equal(decoded.email, payload.email);
  });

  it("detects expired tokens", () => {
    const payload = { userId: "test-user-id", email: "test@example.com" };
    // Token that expired 5 seconds ago
    const expiredToken = jwt.sign(payload, getJwtSecret(), { expiresIn: "-5s" });

    assert.throws(() => {
      jwt.verify(expiredToken, getJwtSecret());
    }, /jwt expired/);
  });
});

describe("Authentication — Middleware", () => {
  it("rejects request without Authorization header", (t, done) => {
    const req = { headers: {} };
    const res = {};
    authenticate(req, res, (err) => {
      assert.ok(err);
      assert.equal(err.statusCode, 401);
      assert.match(err.message, /Authentication required/);
      done();
    });
  });

  it("rejects non-Bearer Authorization header", (t, done) => {
    const req = { headers: { authorization: "Basic dXNlcjpwYXNz" } };
    const res = {};
    authenticate(req, res, (err) => {
      assert.ok(err);
      assert.equal(err.statusCode, 401);
      done();
    });
  });

  it("rejects invalid JWT token", (t, done) => {
    const req = { headers: { authorization: "Bearer invalid.fake.token" } };
    const res = {};
    authenticate(req, res, (err) => {
      assert.ok(err);
      assert.equal(err.statusCode, 401);
      assert.match(err.message, /Invalid authentication token/);
      done();
    });
  });

  it("attaches req.user for valid token and calls next() without error", (t, done) => {
    const payload = { userId: "user-12345", email: "alice@example.com" };
    const token = signToken(payload);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = {};

    authenticate(req, res, (err) => {
      assert.equal(err, undefined);
      assert.ok(req.user);
      assert.equal(req.user.userId, "user-12345");
      assert.equal(req.user.email, "alice@example.com");
      done();
    });
  });
});

describe("Authentication — Zod Schema Validation", async () => {
  const { registerSchema, loginSchema, validateAuth } = await import(
    "../validation/authSchema.js"
  );

  it("accepts valid registration payload", () => {
    const validData = {
      name: "Yuvraj Sharma",
      email: "yuvraj@example.com",
      password: "StrongPassword123",
      businessName: "Nexa Inc",
    };
    const result = validateAuth(registerSchema, validData);
    assert.equal(result.ok, true);
    assert.equal(result.data.email, "yuvraj@example.com");
  });

  it("rejects registration with empty name", () => {
    const data = {
      name: "   ",
      email: "test@example.com",
      password: "StrongPassword123",
    };
    const result = validateAuth(registerSchema, data);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("Name cannot be empty")));
  });

  it("rejects registration with invalid email", () => {
    const data = {
      name: "Test User",
      email: "invalid-email-format",
      password: "StrongPassword123",
    };
    const result = validateAuth(registerSchema, data);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("valid email address")));
  });

  it("rejects password shorter than 8 chars", () => {
    const data = {
      name: "Test User",
      email: "test@example.com",
      password: "Short1",
    };
    const result = validateAuth(registerSchema, data);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("at least 8 characters")));
  });

  it("rejects password missing uppercase letter", () => {
    const data = {
      name: "Test User",
      email: "test@example.com",
      password: "lowercase12345",
    };
    const result = validateAuth(registerSchema, data);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("uppercase")));
  });

  it("rejects password missing numbers", () => {
    const data = {
      name: "Test User",
      email: "test@example.com",
      password: "NoNumbersPassword",
    };
    const result = validateAuth(registerSchema, data);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("number")));
  });

  it("accepts valid login credentials", () => {
    const data = {
      email: "user@example.com",
      password: "AnyPassword123",
    };
    const result = validateAuth(loginSchema, data);
    assert.equal(result.ok, true);
  });

  it("rejects login with empty email", () => {
    const data = {
      email: "",
      password: "password",
    };
    const result = validateAuth(loginSchema, data);
    assert.equal(result.ok, false);
  });
});
