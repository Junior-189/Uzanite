import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { TokenService } from '../../security/token.service';
import { LockoutService } from '../../security/lockout.service';

// JwtModule is registered globally in AppModule.
@Module({
  controllers: [AuthController],
  providers: [AuthService, TokenService, LockoutService],
  exports: [TokenService, AuthService],
})
export class IdentityModule {}
