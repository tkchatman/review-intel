export function notFoundHandler(req, res) {
  res.status(404).json({
    error: {
      message: "Route not found",
      path: req.originalUrl,
    },
  });
}

export function errorHandler(error, req, res, next) {
  const statusCode = error.statusCode ?? 500;

  res.status(statusCode).json({
    error: {
      message: statusCode === 500 ? "Internal server error" : error.message,
      ...(process.env.NODE_ENV !== "production" ? { detail: error.message } : {}),
    },
  });
}
