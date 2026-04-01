const crypto = require("crypto");
const fetch = global.fetch || require("node-fetch");

function normalizeRedisBaseUrl(url) {
  return String(url || "").replace(/\/+$/, "");
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim().replace(/^::ffff:/, "");
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function endpointHash(req) {
  const endpoint = `${req.method}:${req.baseUrl || ""}${req.path || req.originalUrl || ""}`;
  return crypto.createHash("sha1").update(endpoint).digest("hex");
}

async function upstashCommand(baseUrl, token, commandArgs) {
  const encoded = commandArgs.map((part) => encodeURIComponent(String(part))).join("/");
  const res = await fetch(`${baseUrl}/${encoded}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`redis_http_${res.status}`);
  }

  const body = await res.json().catch(() => null);
  if (!body || body.error) {
    throw new Error(body?.error || "redis_invalid_response");
  }

  return body.result;
}

function rateLimitRedis({ windowMs, maxRequests }) {
  if (!Number.isInteger(windowMs) || windowMs <= 0) {
    throw new Error("rateLimitRedis: windowMs must be a positive integer");
  }
  if (!Number.isInteger(maxRequests) || maxRequests <= 0) {
    throw new Error("rateLimitRedis: maxRequests must be a positive integer");
  }

  return async function redisRateLimitMiddleware(req, res, next) {
    const redisUrl = process.env.REDIS_URL;
    const redisToken = process.env.REDIS_TOKEN;

    // Fail closed when Redis configuration is missing.
    if (!redisUrl || !redisToken) {
      return res.status(429).json({
        success: false,
        error: { message: "too_many_requests" },
      });
    }

    const baseUrl = normalizeRedisBaseUrl(redisUrl);
    const now = Date.now();
    const windowBucket = Math.floor(now / windowMs);
    const key = `rl:${endpointHash(req)}:${getClientIp(req)}:${windowBucket}`;

    try {
      const countRaw = await upstashCommand(baseUrl, redisToken, ["INCR", key]);
      const count = Number(countRaw);

      if (!Number.isFinite(count)) {
        throw new Error("redis_invalid_count");
      }

      if (count === 1) {
        await upstashCommand(baseUrl, redisToken, ["PEXPIRE", key, windowMs]);
      }

      if (count > maxRequests) {
        return res.status(429).json({
          success: false,
          error: { message: "too_many_requests" },
        });
      }

      return next();
    } catch (_error) {
      // Fail closed when Redis is unavailable or returns malformed data.
      return res.status(429).json({
        success: false,
        error: { message: "too_many_requests" },
      });
    }
  };
}

module.exports = {
  rateLimitRedis,
};
