import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateConfig } from "../config.js";

describe("Configuration — Environment Variables Validation", () => {
  const completeEnv = {
    PORT: "5000",
    FRONTEND_URL: "http://localhost:5173",
    MONGODB_URI: "mongodb://localhost:27017/paynexa",
    PAYPAL_CLIENT_ID: "sandbox_client_id_12345",
    PAYPAL_CLIENT_SECRET: "sandbox_client_secret_67890",
    PAYPAL_BASE_URL: "https://api-m.sandbox.paypal.com",
    GEMINI_API_KEY: "gemini_key_1234567890",
    JWT_SECRET: "minimum_32_characters_secret_key_for_testing_purposes",
  };

  it("succeeds when all required environment variables are present", () => {
    const config = validateConfig(completeEnv);
    assert.equal(config.port, 5000);
    assert.equal(config.paypalBaseUrl, "https://api-m.sandbox.paypal.com");
    assert.equal(config.jwtSecret, completeEnv.JWT_SECRET);
  });

  it("throws descriptive error when required variables are missing", () => {
    const missingEnv = {
      ...completeEnv,
      MONGODB_URI: "",
      PAYPAL_CLIENT_ID: undefined,
    };

    assert.throws(
      () => validateConfig(missingEnv),
      (err) => {
        assert.match(err.message, /Missing required environment variable\(s\)/);
        assert.match(err.message, /MONGODB_URI/);
        assert.match(err.message, /PAYPAL_CLIENT_ID/);
        return true;
      }
    );
  });

  it("throws error when JWT_SECRET is shorter than 32 characters", () => {
    const weakJwtEnv = {
      ...completeEnv,
      JWT_SECRET: "short_secret",
    };

    assert.throws(
      () => validateConfig(weakJwtEnv),
      /JWT_SECRET must be at least 32 characters long/
    );
  });
});
