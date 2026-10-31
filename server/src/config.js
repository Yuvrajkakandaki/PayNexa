import dotenv from "dotenv";

dotenv.config();

const REQUIRED_ENV_VARS = [
  "MONGODB_URI",
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "PAYPAL_BASE_URL",
  "GEMINI_API_KEY",
  "JWT_SECRET",
];

/**
 * Validates that all required environment variables are set.
 * Throws a descriptive error if any are missing.
 */
export function validateConfig(env = process.env) {
  const missing = [];

  for (const key of REQUIRED_ENV_VARS) {
    if (!env[key] || !env[key].trim()) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s) in .env: ${missing.join(", ")}\n` +
      `Please check server/.env.example for required configuration.`
    );
  }

  if (env.JWT_SECRET && env.JWT_SECRET.trim().length < 32) {
    throw new Error(
      "JWT_SECRET must be at least 32 characters long for cryptographic security."
    );
  }

  return {
    port: Number(env.PORT) || 5000,
    frontendUrl: env.FRONTEND_URL || "http://localhost:5173",
    mongodbUri: env.MONGODB_URI,
    paypalClientId: env.PAYPAL_CLIENT_ID,
    paypalClientSecret: env.PAYPAL_CLIENT_SECRET,
    paypalBaseUrl: env.PAYPAL_BASE_URL,
    paypalWebhookId: env.PAYPAL_WEBHOOK_ID || null,
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL || "gemini-3.5-flash-lite",
    jwtSecret: env.JWT_SECRET,
  };
}

export const config = {
  port: Number(process.env.PORT) || 5000,
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",
  mongodbUri: process.env.MONGODB_URI,
  paypalClientId: process.env.PAYPAL_CLIENT_ID,
  paypalClientSecret: process.env.PAYPAL_CLIENT_SECRET,
  paypalBaseUrl: process.env.PAYPAL_BASE_URL,
  paypalWebhookId: process.env.PAYPAL_WEBHOOK_ID || null,
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
  jwtSecret: process.env.JWT_SECRET,
};
