import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service';

// Global: the guards and several services depend on it, and it holds no
// per-module state.
@Global()
@Module({
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
