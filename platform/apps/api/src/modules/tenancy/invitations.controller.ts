import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { acceptInviteSchema } from '@uzanite/contracts';
import { Public } from '../../decorators/public.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { MembershipsService } from './memberships.service';

// Public invitation acceptance. Unauthenticated by design (the invitee has no
// account yet); the single-use, expiring token is the credential.
@ApiTags('auth')
@RateLimit({ limit: 30, windowSeconds: 900, keyPrefix: 'accept-invite', scope: 'ip' })
@Controller()
export class InvitationsController {
  constructor(private readonly members: MembershipsService) {}

  @Public()
  @HttpCode(200)
  @Post('auth/accept-invite')
  accept(@Body(new ZodValidationPipe(acceptInviteSchema)) body: unknown) {
    return this.members.acceptInvite(body as never);
  }
}
