const { ZodError } = require('zod');

// Validates and *replaces* req[source] with the parsed (typed, stripped) value.
// Rejecting unknown keys is enforced by the schemas (.strict()) where desired.
function validate(schema, source = 'body') {
  return (req, res, next) => {
    try {
      const parsed = schema.parse(req[source]);
      if (source === 'body' || source === 'params') {
        req[source] = parsed;
      } else {
        // Express 4: req.query is a getter; merge safely instead of reassigning.
        Object.keys(parsed).forEach((k) => {
          req.query[k] = parsed[k];
        });
      }
      next();
    } catch (err) {
      // `instanceof` can fail across CJS/ESM builds of zod, so also match by name.
      const isZod = err instanceof ZodError || (err && err.name === 'ZodError' && Array.isArray(err.issues));
      if (isZod) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: (err.issues || []).map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }
      next(err);
    }
  };
}

module.exports = { validate };
