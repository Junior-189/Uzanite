import { Controller, HttpCode, Logger, NotFoundException, Param, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { webhookProviderParam } from '@uzanite/contracts';
import { Public } from '../../decorators/public.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { MetricsService } from '../../metrics/metrics.service';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { PaymentsService } from './payments.service';
import { PaymentAdaptersService } from './payments/payment-adapters.service';

// Provider webhooks are unauthenticated but signature-verified. The raw body is
// required for HMAC verification (`rawBody: true` in main.ts).
@ApiTags('payments')
@RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: 'wh:payments', scope: 'ip' })
@Controller('payments/webhook')
export class PaymentsWebhookController {
  private readonly logger = new Logger(PaymentsWebhookController.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly adapters: PaymentAdaptersService,
    private readonly metrics: MetricsService
  ) {}

  @Public()
  @Post(':provider')
  @HttpCode(200)
  async handle(@Param(new ZodValidationPipe(webhookProviderParam)) params: { provider: string }, @Req() req: Request) {
    const adapter = this.adapters.get(params.provider);
    if (!adapter || adapter.name === 'manual' || !adapter.enabled()) {
      this.metrics.observePaymentWebhook(params.provider, 'unknown_provider');
      throw new NotFoundException('Unknown or disabled payment provider');
    }

    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? JSON.stringify(req.body ?? {});
    if (!adapter.verifySignature(rawBody, req.headers as unknown as Record<string, unknown>)) {
      this.metrics.observePaymentWebhook(adapter.name, 'invalid_signature');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    try {
      const parsed = adapter.parseWebhook((req.body ?? {}) as Record<string, unknown>);
      if (!parsed?.providerRef) {
        this.metrics.observePaymentWebhook(adapter.name, 'unmatched');
        return { success: true, matched: false };
      }

      const result = await this.payments.applyProviderResult({
        providerName: adapter.name,
        providerRef: parsed.providerRef,
        status: parsed.status,
        amount: parsed.amount,
        currency: parsed.currency,
        failureReason: parsed.failureReason,
        raw: parsed.raw,
      });
      return { success: true, matched: result.matched, duplicate: result.duplicate ?? false };
    } catch (err) {
      this.metrics.observePaymentWebhook(adapter.name, 'error');
      this.logger.error(`Payment webhook (${adapter.name}) failed: ${(err as Error).message}`);
      throw err;
    }
  }
}
