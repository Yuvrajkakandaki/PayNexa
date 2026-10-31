import jwt from "jsonwebtoken";
import { AppError } from "../errors/AppError.js";

const DEFAULT_JWT_SECRET = "paynexa_jwt_secret_dev_key_min_32_characters_long_123456";

export function getJwtSecret() {
  return process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
}

/**
 * Generate a JWT token valid for 7 days
 */
export function signToken(payload) {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: "7d" });
}

/**
 * Authenticate middleware: verifies Bearer JWT token on protected routes
 */
export function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next(new AppError("Authentication required. Please log in.", 401));
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    return next(new AppError("Authentication token is missing.", 401));
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
    };
    return next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return next(new AppError("Your session has expired. Please log in again.", 401));
    }
    return next(new AppError("Invalid authentication token.", 401));
  }
}
