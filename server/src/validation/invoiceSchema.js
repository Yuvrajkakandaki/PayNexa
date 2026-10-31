import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared limits — change here and it applies everywhere
// ---------------------------------------------------------------------------

export const MAX_ITEM_NAME_LENGTH = 200;
export const MAX_CLIENT_NAME_LENGTH = 100;
export const MAX_UNIT_PRICE = 1_000_000;  // $1 million max per item
export const MAX_QUANTITY = 10_000;        // 10k units max per item
export const MAX_ITEMS = 20;              // max line items per invoice
export const MAX_PROMPT_LENGTH = 2000;     // max characters for prompt description

// Only the three currencies the task requires
export const ALLOWED_CURRENCIES = ["USD", "EUR", "GBP"];

// ---------------------------------------------------------------------------
// Zod schema for a single line item
// ---------------------------------------------------------------------------

export const itemSchema = z.object({
  // name must be a non-empty string
  name: z
    .string({ required_error: "Item name is required." })
    .trim()
    .min(1, "Item name cannot be empty.")
    .max(MAX_ITEM_NAME_LENGTH, `Item name cannot exceed ${MAX_ITEM_NAME_LENGTH} characters.`),

  // quantity must be a positive whole number
  quantity: z
    .number({ required_error: "Item quantity is required.", invalid_type_error: "Item quantity must be a number." })
    .int("Item quantity must be a whole number.")
    .min(1, "Item quantity must be at least 1.")
    .max(MAX_QUANTITY, `Item quantity cannot exceed ${MAX_QUANTITY}.`),

  // unitPrice must be greater than 0 (not free — task says greater than 0)
  unitPrice: z
    .number({ required_error: "Item unit price is required.", invalid_type_error: "Item unit price must be a number." })
    .positive("Item unit price must be greater than 0.")
    .max(MAX_UNIT_PRICE, `Item unit price cannot exceed ${MAX_UNIT_PRICE}.`),
});

// ---------------------------------------------------------------------------
// Zod schema for the AI-returned invoice details
// This is validated BEFORE calling PayPal — AI output is untrusted.
// ---------------------------------------------------------------------------

export const aiInvoiceSchema = z.object({
  // clientName comes from AI (the email is provided by the user separately)
  clientName: z
    .string({ required_error: "Client name is required." })
    .trim()
    .min(1, "Client name cannot be empty.")
    .max(MAX_CLIENT_NAME_LENGTH, `Client name cannot exceed ${MAX_CLIENT_NAME_LENGTH} characters.`),

  // items: at least 1, max MAX_ITEMS
  items: z
    .array(itemSchema)
    .min(1, "Invoice must have at least one item.")
    .max(MAX_ITEMS, `Invoice cannot have more than ${MAX_ITEMS} line items.`),

  // currency: one of USD, EUR, GBP (task requirement)
  currency: z
    .string()
    .transform((val) => val.toUpperCase())
    .pipe(
      z.enum(ALLOWED_CURRENCIES, {
        errorMap: () => ({
          message: `Currency must be one of: ${ALLOWED_CURRENCIES.join(", ")}.`,
        }),
      })
    ),

  // dueDate: must be a valid YYYY-MM-DD date that is not in the past
  dueDate: z
    .string({ required_error: "Due date is required." })
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Due date must be in YYYY-MM-DD format.")
    .refine((val) => {
      // Check it is a real calendar date (e.g. reject 2026-02-30)
      const ms = Date.parse(`${val}T00:00:00Z`);
      if (Number.isNaN(ms)) return false;
      return new Date(ms).toISOString().slice(0, 10) === val;
    }, "Due date is not a valid calendar date.")
    .refine((val) => {
      // Not in the past: compare against today's UTC date
      const today = new Date().toISOString().slice(0, 10);
      return val >= today;
    }, "Due date cannot be in the past."),
});

// ---------------------------------------------------------------------------
// Helper: run a Zod schema and return { ok, errors }
// errors is an array of human-readable strings like "items[0].quantity: ..."
// ---------------------------------------------------------------------------

export function validate(schema, data) {
  const result = schema.safeParse(data);

  if (result.success) {
    // Return the parsed (and transformed) data so callers use the clean copy
    return { ok: true, data: result.data, errors: [] };
  }

  // Format each Zod issue into a readable message
  const errors = result.error.issues.map((issue) => {
    // issue.path is an array like ["items", 0, "unitPrice"]
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  });

  return { ok: false, data: null, errors };
}
