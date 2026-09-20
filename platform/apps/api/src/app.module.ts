import { randomUUID } from 'crypto';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { JwtModule } from '@nestjs/jwt';
import { LoggerModule } from 'nestjs-pino';

import { validateEnv } from './config/env';
import { JWT_ALGORITHM, JWT_AUDIENCE, JWT_ISSUER } from './security/jwt.constants';
import { getCorrelation } from './context/tenant-context';
import { ObservabilityModule } from './observability/observability.module';
import { SecurityModule } from './security/security.module';
import { AdminAccessAuditInterceptor } from './interceptors/admin-access-audit.interceptor';
import { ApiVersionInterceptor } from './versioning/api-version.interceptor';
import { CacheModule } from './cache/cache.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { QueueModule } from './queue/queue.module';
import { MetricsModule } from './metrics/metrics.module';
import { OutboxModule } from './outbox/outbox.module';
import { EmailModule } from './email/email.module';

import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { TenantGuard } from './guards/tenant.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { PlanGuard } from './guards/plan.guard';
import { RateLimitGuard } from './guards/rate-limit.guard';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { MetricsInterceptor } from './interceptors/metrics.interceptor';
import { TenantTransactionInterceptor } from './interceptors/tenant-transaction.interceptor';
import { requestContextMiddleware } from './middleware/request-context.middleware';

import { IdentityModule } from './modules/identity/identity.module';
import { IdentityResolverModule } from './modules/identity/identity-resolver.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import { BillingModule } from './modules/billing/billing.module';
import { AdminModule } from './modules/admin/admin.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CommerceModule } from './modules/commerce/commerce.module';
import { FinanceModule } from './modules/finance/finance.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ReceiptsModule } from './modules/receipts/receipts.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { ConversationModule } from './modules/conversation/conversation.module';
import { HealthModule } from './modules/health/health.module';
import { PrivacyModule } from './modules/privacy/privacy.module';
import { FilesModule } from './modules/files/files.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { RecycleBinModule } from './modules/recycle-bin/recycle-bin.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { StaffModule } from './modules/staff/staff.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL || 'info',
        genReqId: (req, res) => {
          const id = (req.headers['x-request-id'] as string) || randomUUID();
          res.setHeader('X-Request-Id', id);
          return id;
        },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.password',
            'req.body.currentPassword',
            'req.body.newPassword',
            'req.body.refreshToken',
          ],
          censor: '[REDACTED]',
        },
        // Attach tenant/user/trace correlation to every log line.
        mixin: () => {
          const c = getCorrelation();
          return {
            requestId: c.requestId,
            traceId: c.traceId,
            tenantId: c.tenantId ?? undefined,
            userId: c.userId,
          };
        },
      },
    }),
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        // Pin issuer/audience and the algorithm allowlist rather than relying on
        // library defaults: a token minted for another UZANITE surface (or with
        // an unexpected `alg`) must not validate here.
        signOptions: {
          expiresIn: config.get<string>('JWT_ACCESS_TTL') ?? '15m',
          algorithm: JWT_ALGORITHM,
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        },
        verifyOptions: {
          algorithms: [JWT_ALGORITHM],
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        },
      }),
    }),
    EventEmitterModule.forRoot(),
    ObservabilityModule,
    SecurityModule,
    CacheModule,
    PrismaModule,
    RedisModule,
    QueueModule,
    MetricsModule,
    OutboxModule,
    EmailModule,
    IdentityResolverModule,
    IdentityModule,
    TenancyModule,
    BillingModule,
    AdminModule,
    CatalogModule,
    CommerceModule,
    FinanceModule,
    NotificationsModule,
    ReceiptsModule,
    MessagingModule,
    ConversationModule,
    PrivacyModule,
    FilesModule,
    DashboardModule,
    RecycleBinModule,
    ContactsModule,
    StaffModule,
    HealthModule,
  ],
  providers: [
    // Guard order matters: auth -> tenant -> permissions -> plan -> rate limit.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: PlanGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ApiVersionInterceptor },
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
    // Records platform-admin access to tenant data. Registered before the
    // transaction interceptor so the audit write joins the request transaction.
    { provide: APP_INTERCEPTOR, useClass: AdminAccessAuditInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TenantTransactionInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestContextMiddleware).forRoutes('*');
  }
}
