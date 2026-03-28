const { verifyToken } = require("../services/jwtService");
const { createHttpError } = require("./errorHandler");

function requireAuth(expectedType) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const [scheme, token] = header.split(" ");

    if (scheme !== "Bearer" || !token) {
      return next(createHttpError(401, "Missing Bearer token"));
    }

    try {
      const payload = verifyToken(token, expectedType);
      req.auth = payload;
      return next();
    } catch (error) {
      return next(createHttpError(401, "Invalid token"));
    }
  };
}

module.exports = requireAuth;
