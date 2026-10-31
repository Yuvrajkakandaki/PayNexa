/**
 * asyncWrap — wraps an async route handler so that any thrown error or
 * rejected promise is forwarded to Express's next(err) automatically.
 *
 * Without this wrapper, an unhandled promise rejection inside an async
 * route handler silently crashes the process (or hangs the request).
 *
 * Usage:
 *   app.get("/api/foo", asyncWrap(async (req, res) => { ... }));
 */
export function asyncWrap(fn) {
  // Return a regular (non-async) function that Express will call.
  // If fn rejects, the catch passes the error to next() → error handler.
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
