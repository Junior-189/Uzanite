/* eslint-disable no-console */
/**
 * Emits the OpenAPI document to stdout or a file without starting a server.
 *
 * Purpose: make the API contract a build artifact so CI can diff it against the
 * previous commit and fail on a breaking change. Before this, nothing verified
 * that a platform response stayed compatible with the legacy response it
 * replaces, which is the highest-risk gap in a Strangler Fig migration.
 *
 * Usage: tsx src/openapi.ts [outputPath]
 */
import 'reflect-metadata';
import { writeFileSync } from 'fs';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

// Minimal env MUST be set before the app module is imported: config validation
// runs at module-load time, so a static import would fail before main() runs.
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'openapi-generation-secret-0123456789abcdef0123456789';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://localhost:5432/uzanite?schema=public';
process.env.SKIP_DB_CONNECT = 'true';

async function main(): Promise<void> {
  const { AppModule } = await import('./app.module');
  const { CURRENT_API_VERSION } = await import('./versioning/api-version');

  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  app.setGlobalPrefix('api/v1');

  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('UZANITE API')
      .setDescription('UZANITE platform API')
      .setVersion(CURRENT_API_VERSION)
      .addBearerAuth()
      .build()
  );

  const out = process.argv[2];
  const json = JSON.stringify(doc, null, 2);
  if (out) {
    writeFileSync(out, `${json}\n`);
    console.error(`OpenAPI written to ${out} (${Object.keys(doc.paths ?? {}).length} paths)`);
  } else {
    console.log(json);
  }
  await app.close();
}

main().catch((err) => {
  console.error('OpenAPI generation failed:', err);
  process.exit(1);
});
