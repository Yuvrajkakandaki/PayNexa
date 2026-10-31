import express from "express";
import rateLimit from "express-rate-limit";
import User from "../models/User.js";
import { signToken, authenticate } from "../middleware/authenticate.js";
import { asyncWrap } from "../middleware/asyncWrap.js";
import { AppError } from "../errors/AppError.js";
import {
  registerSchema,
  loginSchema,
  validateAuth,
} from "../validation/authSchema.js";

const router = express.Router();

// Strict rate limit for login: 5 attempts per minute per IP (Task 4.2)
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please wait 1 minute before trying again." },
});

// Strict rate limit for registration: 10 accounts per hour per IP (Task 4.2)
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many registration attempts. Please try again later." },
});

/**
 * POST /api/auth/register
 * Validates input via Zod and creates a new user account
 */
router.post(
  "/register",
  registerLimiter,
  asyncWrap(async (req, res) => {
    // 1. Zod input validation (Task 4.3)
    const validation = validateAuth(registerSchema, req.body);
    if (!validation.ok) {
      return res.status(400).json({
        error: "Validation failed.",
        details: validation.errors,
      });
    }

    const { name, email, password, businessName } = validation.data;

    // 2. Check for existing account
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw new AppError("An account with this email already exists.", 409);
    }

    // 3. Hash password with bcrypt
    const passwordHash = await User.hashPassword(password);

    const user = await User.create({
      name,
      email,
      passwordHash,
      businessName: businessName || "",
    });

    const token = signToken({
      userId: user._id.toString(),
      email: user.email,
    });

    return res.status(201).json({
      success: true,
      message: "Account created successfully!",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        businessName: user.businessName,
      },
    });
  })
);

/**
 * POST /api/auth/login
 * Validates credentials and returns a JWT
 */
router.post(
  "/login",
  loginLimiter,
  asyncWrap(async (req, res) => {
    // 1. Zod input validation (Task 4.3)
    const validation = validateAuth(loginSchema, req.body);
    if (!validation.ok) {
      return res.status(400).json({
        error: "Validation failed.",
        details: validation.errors,
      });
    }

    const { email, password } = validation.data;

    const user = await User.findOne({ email });
    if (!user) {
      throw new AppError("Invalid email or password.", 401);
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      throw new AppError("Invalid email or password.", 401);
    }

    const token = signToken({
      userId: user._id.toString(),
      email: user.email,
    });

    return res.status(200).json({
      success: true,
      message: "Login successful!",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        businessName: user.businessName,
      },
    });
  })
);

/**
 * GET /api/auth/me
 * Retrieves current authenticated user's profile
 */
router.get(
  "/me",
  authenticate,
  asyncWrap(async (req, res) => {
    const user = await User.findById(req.user.userId).lean();

    if (!user) {
      throw new AppError("User not found.", 404);
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        businessName: user.businessName,
        createdAt: user.createdAt,
      },
    });
  })
);

export default router;
