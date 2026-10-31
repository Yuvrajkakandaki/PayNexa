/**
 * AppError — a custom error class that carries an HTTP status code.
 *
 * Usage:
 *   throw new AppError("Invoice not found.", 404);
 *
 * In the central error handler we check `err instanceof AppError` to know
 * whether the message is safe to send to the client.
 */
export class AppError extends Error {
  constructor(message, statusCode) {
    super(message);           // sets this.message
    this.statusCode = statusCode;
    this.isOperational = true; // marks it as an expected, handled error
    // Capture the call stack (V8 only) for better server-side logging
    Error.captureStackTrace(this, this.constructor);
  }
}
