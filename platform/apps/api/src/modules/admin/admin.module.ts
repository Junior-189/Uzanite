import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { FeatureFlagsController } from './feature-flags.controller';
import { FeatureFlagsService } from './feature-flags.service';
import { IdentityModule } from '../identity/identity.module';

@Module({
  imports: [IdentityModule],
  controllers: [AdminController, FeatureFlagsController],
  providers: [AdminService, FeatureFlagsService],
  // Exported so other modules can gate behaviour on a flag (kill switches).
  exports: [FeatureFlagsService],
})
export class AdminModule {}
