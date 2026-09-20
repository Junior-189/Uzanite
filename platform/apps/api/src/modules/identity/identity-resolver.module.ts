import { Global, Module } from '@nestjs/common';
import { IdentityResolverService } from './identity-resolver.service';

// Global so the global JwtAuthGuard (declared in AppModule) can inject it.
@Global()
@Module({
  providers: [IdentityResolverService],
  exports: [IdentityResolverService],
})
export class IdentityResolverModule {}
