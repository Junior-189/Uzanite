import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { z } from 'zod';
import { MetaClient } from '@uzanite/messaging';
import { WorkerService } from './worker.service';
import { EmailService } from './email.service';
import { WorkerErrorTracker } from './error-tracker.service';
import { OutboxPublisherService } from './outbox-publisher.service';
import { ReconciliationService } from './reconciliation.service';
import { RetentionService } from './retention.service';
import { NotificationWriter } from './consumers/notification-writer.service';
import { ReceiptWriter } from './consumers/receipt-writer.service';
import { OutboxDispatcherService } from './consumers/outbox-dispatcher.service';
import { WhatsAppOutboundService } from './messaging/whatsapp-outbound.service';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().optional().default(''),
  REDIS_URL: z.string().optional().default(''),
  LOG_LEVEL: z.string().default('info'),
  PUBLIC_APP_URL: z.string().optional().default(''),
  // How often the reconciliation sweep runs (default 15 min).
  RECONCILE_INTERVAL_MS: z.coerce.number().int().optional(),
  // Data retention (PDPA). 0 disables an individual sweep.
  RETENTION_INTERVAL_MS: z.coerce.number().int().optional(),
  RETENTION_BATCH_SIZE: z.coerce.number().int().optional(),
  RETENTION_FLOW_TRACE_DAYS: z.coerce.number().int().optional(),
  RETENTION_WEBHOOK_EVENT_DAYS: z.coerce.number().int().optional(),
  RETENTION_LOGIN_ATTEMPT_DAYS: z.coerce.number().int().optional(),
  RETENTION_ACTIVITY_LOG_DAYS: z.coerce.number().int().optional(),
  RETENTION_MESSAGE_DAYS: z.coerce.number().int().optional().default(0),
  // Error reporting (optional; logged only when unset).
  SENTRY_DSN: z.string().optional().default(''),
  APP_RELEASE: z.string().optional().default('unknown'),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  EMAIL_FROM: z.string().optional().default('UZANITE <no-reply@uzanite.local>'),
});

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config) => envSchema.parse(config),
    }),
  ],
  providers: [
    WorkerService,
    WorkerErrorTracker,
    EmailService,
    NotificationWriter,
    ReceiptWriter,
    { provide: MetaClient, useFactory: () => new MetaClient() },
    WhatsAppOutboundService,
    OutboxDispatcherService,
    OutboxPublisherService,
    ReconciliationService,
    RetentionService,
  ],
})
export class WorkerAppModule {}
