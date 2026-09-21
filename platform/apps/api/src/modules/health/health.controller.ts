import { Controller, Get, Req, Res } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Public } from '../../decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { MetricsService } from '../../metrics/metrics.service';
import { OperationalMetricsService } from '../../observability/operational-metrics.service';

// Length-independent constant-time comparison.
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so the mismatch is not distinguishable by timing.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly metrics: MetricsService,
    private readonly operational: OperationalMetricsService,
    private readonly config: ConfigService
  ) {}

  @Public()
  @Get('health')
  health() {
    return { status: 'ok', service: 'uzanite-api', timestamp: new Date().toISOString() };
  }

  @Public()
  @Get('ready')
  async ready(@Res() res: Response) {
    const [db, cache] = await Promise.all([this.prisma.ping(), this.redis.ping()]);
    const ready = db && cache;
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      service: 'uzanite-api',
      checks: { postgres: db ? 'up' : 'down', redis: this.redis.enabled ? (cache ? 'up' : 'down') : 'disabled' },
      timestamp: new Date().toISOString(),
    });
  }

  // Prometheus scrape endpoint. Protected by METRICS_TOKEN when set; in
  // production an unset token denies access (fail closed) so metrics never
  // leak tenant/business data or dependency state.
  @Public()
  @Get('metrics')
  async metricsEndpoint(@Req() req: Request, @Res() res: Response) {
    const expected = this.config.get<string>('METRICS_TOKEN') ?? '';
    const isProduction = this.config.get<string>('NODE_ENV') === 'production';
    if (expected) {
      const provided = req.headers['x-metrics-token'] as string | undefined;
      // Constant-time compare so the token cannot be recovered byte-by-byte
      // from response timing.
      if (!provided || !safeEqual(provided, expected)) {
        res.status(403).send('forbidden');
        return;
      }
    } else if (isProduction) {
      res.status(403).send('forbidden');
      return;
    }

    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    const base = await this.metrics.render();
    const operational = await this.operational.collect();
    res.send(operational ? `${base.trimEnd()}\n${operational}\n` : base);
  }
}
