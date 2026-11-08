import jwt from "jsonwebtoken";
import { AppError } from "../errors/AppError.js";

export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set. Add it to server/.env.");
  }
  return secret;
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
