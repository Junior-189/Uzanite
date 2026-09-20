import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { securityHeadersMiddleware } from './middleware/security-headers.middleware';
import { compressionMiddleware } from './middleware/compression.middleware';

async function bootstrap(): Promise<void> {
  // `rawBody` is retained so payment provider webhooks can verify HMAC signatures.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService);
  const isProduction = config.get<string>('NODE_ENV') === 'production';

  // ── Trust the reverse proxy so `req.ip` is the real client.
  // This is load-bearing for security, not cosmetic: the Redis rate limiter and
  // the lockout keys are derived from req.ip. Without it, every request behind
  // the gateway/load balancer shares the proxy's address, collapsing per-client
  // limits into ONE global bucket per route — abuse becomes indistinguishable
  // from aggregate traffic, and a single noisy client can 429 every tenant.
  // TRUST_PROXY_HOPS = number of trusted proxies in front of the API
  // (1 = one nginx/ALB; 0 disables, for direct exposure).
  const trustProxyHops = config.get<number>('TRUST_PROXY_HOPS') ?? 1;
  app.set('trust proxy', trustProxyHops > 0 ? trustProxyHops : false);

  // ── CORS: explicit allow-list from CORS_ORIGINS (never reflect arbitrary origins).
  // Requests without an Origin header (native apps, curl, server-to-server) are
  // allowed; browsers must match the allow-list.
  const allowedOrigins = (config.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id', 'X-Request-Id', 'X-Metrics-Token'],
    maxAge: 600,
  });

  // Security headers (Helmet-equivalent) applied to every response.
  app.use(securityHeadersMiddleware(isProduction));

  // gzip responses for low-bandwidth clients.
  app.use(compressionMiddleware());

  app.setGlobalPrefix('api/v1');

  if (!isProduction) {
    const doc = new DocumentBuilder()
      .setTitle('UZANITE API')
      .setDescription('UZANITE platform API (Phase M1: Identity + Tenancy)')
      .setVersion('1')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/v1/docs', app, SwaggerModule.createDocument(app, doc));
  }

  // Drain the Prisma/Redis/BullMQ connections cleanly on SIGTERM/SIGINT.
  app.enableShutdownHooks();

  const port = config.get<number>('PORT') ?? 4000;
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`🚀 UZANITE API listening on :${port} (prefix /api/v1)`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
