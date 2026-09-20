import { NextFunction, Request, Response } from 'express';

// Helmet-equivalent hardening for the API. Kept dependency-free so the image
// build stays reproducible; the header set mirrors the protections Helmet
// applies by default (plus HSTS in production).
//
// NOTE: The API serves JSON and a self-contained receipt HTML document that
// relies on inline styles, so CSP permits `style-src 'unsafe-inline'` but
// forbids scripts entirely.
export function securityHeadersMiddleware(isProduction: boolean) {
  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('X-Download-Options', 'noopen');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    // Deny browser features this JSON API never needs, so an injected script
    // in a receipt document cannot reach hardware or storage APIs.
    res.setHeader(
      'Permissions-Policy',
      'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()'
    );
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    if (isProduction) {
      // Dev keeps Swagger UI usable (it needs inline scripts); production has it disabled.
      res.setHeader('Content-Security-Policy', csp);
      res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    next();
  };
}
