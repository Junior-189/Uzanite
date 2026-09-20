import { Global, Module } from '@nestjs/common';
import { JwtKeyService } from './jwt-keys.service';
import { TotpService } from './totp.service';

// Global so the guards (APP_GUARD) and feature services can inject the shared
// JWT key set and TOTP service without re-importing.
@Global()
@Module({
  providers: [JwtKeyService, TotpService],
  exports: [JwtKeyService, TotpService],
})
export class SecurityModule {}
