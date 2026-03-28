function createHttpError(statusCode, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details) {
    error.details = details;
  }
  return error;
}

function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const isProduction = process.env.NODE_ENV === "production";
  const safeMessage = isProduction && statusCode >= 500
    ? "Internal Server Error"
    : (err.message || "Internal Server Error");

  const body = {
    error: {
      message: safeMessage,
    },
  };

  if (err.details) {
    body.error.details = err.details;
  }

  if (!isProduction && err.stack) {
    body.error.stack = err.stack;
  }

  res.status(statusCode).json(body);
}

module.exports = {
  createHttpError,
  errorHandler,
};
