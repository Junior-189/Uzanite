import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
} from '@uzanite/contracts';
import { Public } from '../../decorators/public.decorator';
import { CurrentUser } from '../../decorators/principal.decorator';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { Principal } from '../../context/tenant-context';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { AuthService, RequestMeta } from './auth.service';

function metaOf(req: Request): RequestMeta {
  return { ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined };
}

@ApiTags('auth')
@ApiBearerAuth()
@RateLimit({ limit: 20, windowSeconds: 900, keyPrefix: 'auth', scope: 'ip' })
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  register(@Body(new ZodValidationPipe(registerSchema)) body: unknown) {
    return this.auth.register(body as never);
  }

  @Public()
  @HttpCode(200)
  @Post('login')
  login(@Body(new ZodValidationPipe(loginSchema)) body: unknown, @Req() req: Request) {
    return this.auth.login(body as never, metaOf(req));
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body(new ZodValidationPipe(refreshSchema)) body: { refreshToken: string }, @Req() req: Request) {
    return this.auth.refresh(body.refreshToken, metaOf(req));
  }

  @Public()
  @HttpCode(200)
  @Post('logout')
  logout(@Body(new ZodValidationPipe(logoutSchema)) body: { refreshToken?: string }) {
    return this.auth.logout(body.refreshToken);
  }

  @HttpCode(200)
  @Post('change-password')
  changePassword(
    @CurrentUser() principal: Principal,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: unknown,
    @Req() req: Request
  ) {
    return this.auth.changePassword(principal.userId, body as never, metaOf(req));
  }

  @Public()
  @HttpCode(200)
  @Post('forgot-password')
  forgotPassword(@Body(new ZodValidationPipe(forgotPasswordSchema)) body: { email: string }) {
    return this.auth.forgotPassword(body.email);
  }

  @Public()
  @HttpCode(200)
  @Post('reset-password')
  resetPassword(@Body(new ZodValidationPipe(resetPasswordSchema)) body: { token: string; newPassword: string }) {
    return this.auth.resetPassword(body.token, body.newPassword);
  }

  @Get('me')
  me(@CurrentUser() principal: Principal) {
    return this.auth.me(principal.userId);
  }
}
