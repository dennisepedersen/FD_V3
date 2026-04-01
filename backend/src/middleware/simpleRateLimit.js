const windows = new Map();

// NOTE: This is an in-memory limiter.
// - State is per-process and will reset on restart.
// - It does not protect correctly across multiple app instances.
// TODO: Replace with a centralized rate-limit store (e.g. Redis) before scaling out.

function now() {
  return Date.now();
}

function keyFor(req, prefix) {
  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
  return `${prefix}:${ip}`;
}

function simpleRateLimit({ prefix, windowMs, max, message }) {
  return function rateLimitMiddleware(req, res, next) {
    const key = keyFor(req, prefix);
    const ts = now();
    const current = windows.get(key);

    if (!current || ts - current.windowStart >= windowMs) {
      windows.set(key, { windowStart: ts, count: 1 });
      return next();
    }

    if (current.count >= max) {
      return res.status(429).json({
        success: false,
        error: { message },
      });
    }

    current.count += 1;
    windows.set(key, current);
    return next();
  };
}

module.exports = {
  simpleRateLimit,
};
