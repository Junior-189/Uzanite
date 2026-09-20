import { NextFunction, Request, Response } from 'express';
import { gzip } from 'zlib';

// Minimum body size worth compressing.
const MIN_SIZE = 1024;
const COMPRESSIBLE = /(json|text|javascript|xml|svg|csv)/i;

/**
 * Dependency-free gzip response compression. Important for low-bandwidth
 * clients (Tanzanian SME users on mobile data). Only textual bodies produced by
 * `res.json`/`res.send(string|Buffer)` are compressed — streams and already
 * encoded responses pass through untouched. Compression is async so the event
 * loop is never blocked.
 */
export function compressionMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const accept = String(req.headers['accept-encoding'] ?? '');
    if (!/\bgzip\b/.test(accept) || req.method === 'HEAD') return next();

    const originalSend = res.send.bind(res) as (body?: unknown) => Response;

    res.send = function patchedSend(body?: unknown): Response {
      const contentType = String(res.getHeader('Content-Type') ?? '');
      const textual = typeof body === 'string' || Buffer.isBuffer(body);
      const alreadyEncoded = !!res.getHeader('Content-Encoding');
      const isEventStream = contentType.includes('text/event-stream');

      if (!textual || alreadyEncoded || isEventStream || !COMPRESSIBLE.test(contentType)) {
        return originalSend(body);
      }

      const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
      if (buffer.length < MIN_SIZE) return originalSend(body);

      gzip(buffer, (err, compressed) => {
        if (err) return void originalSend(body);
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
        res.setHeader('Content-Length', String(compressed.length));
        res.removeHeader('ETag');
        originalSend(compressed);
      });
      return res;
    };

    next();
  };
}
