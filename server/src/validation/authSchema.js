import { z } from "zod";

/**
 * Registration schema with password complexity rules:
 * - Minimum 8 characters
 * - At least 1 lowercase letter
 * - At least 1 uppercase letter
 * - At least 1 digit
 */
export const registerSchema = z.object({
  name: z
    .string({ required_error: "Name is required." })
    .trim()
    .min(1, "Name cannot be empty.")
    .max(100, "Name cannot exceed 100 characters."),

  email: z
    .string({ required_error: "Email is required." })
    .trim()
    .toLowerCase()
    .email("Please provide a valid email address.")
    .max(254, "Email address is too long."),

  password: z
    .string({ required_error: "Password is required." })
    .min(8, "Password must be at least 8 characters long.")
    .max(100, "Password cannot exceed 100 characters.")
    .refine((val) => /[a-z]/.test(val), {
      message: "Password must contain at least one lowercase letter.",
    })
    .refine((val) => /[A-Z]/.test(val), {
      message: "Password must contain at least one uppercase letter.",
    })
    .refine((val) => /[0-9]/.test(val), {
      message: "Password must contain at least one number.",
    }),

  businessName: z
    .string()
    .trim()
    .max(200, "Business name cannot exceed 200 characters.")
    .optional()
    .or(z.literal("")),
});

/**
 * Login credentials schema
 */
export const loginSchema = z.object({
  email: z
    .string({ required_error: "Email is required." })
    .trim()
    .toLowerCase()
    .email("Please provide a valid email address."),

  password: z
    .string({ required_error: "Password is required." })
    .min(1, "Password is required."),
});

/**
 * Validate input data against a Zod auth schema
 */
export function validateAuth(schema, data) {
  const result = schema.safeParse(data);

  if (result.success) {
    return { ok: true, data: result.data, errors: [] };
  }

  const errors = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  });

  return { ok: false, data: null, errors };
}
