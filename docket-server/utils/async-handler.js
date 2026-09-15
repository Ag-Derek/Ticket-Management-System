// Express doesn't catch a rejected promise from an async route handler —
// an uncaught one becomes an unhandled rejection, which terminates the
// whole process instead of just failing that one request. Wrapping a
// handler in asyncHandler forwards any rejection to next(err), which
// server.js's catch-all error middleware turns into a normal 500.
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
