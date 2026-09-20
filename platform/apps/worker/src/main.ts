import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerAppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerAppModule);
  app.enableShutdownHooks();
  // eslint-disable-next-line no-console
  console.log('👷 UZANITE worker started');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal worker startup error:', err);
  process.exit(1);
});
