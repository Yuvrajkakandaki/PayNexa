/**
 * Request logging middleware:
 * Logs [timestamp] METHOD /path — status — duration ms
 */
export function requestLogger(req, res, next) {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const timestamp = new Date().toISOString();
    const method = req.method;
    const path = req.originalUrl || req.url;
    const status = res.statusCode;

    // Filter out noisy health checks in normal logs if desired, or log concisely
    console.log(`[${timestamp}] ${method} ${path} — ${status} (${duration}ms)`);
  });

  next();
}
