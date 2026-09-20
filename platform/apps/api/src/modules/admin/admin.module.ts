import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { FeatureFlagsController } from './feature-flags.controller';
import { FeatureFlagsService } from './feature-flags.service';
import { AdminLogsController } from './admin-logs.controller';
import { AdminLogsService } from './admin-logs.service';
import { IdentityModule } from '../identity/identity.module';

@Module({
  imports: [IdentityModule],
  controllers: [AdminController, AdminUsersController, FeatureFlagsController, AdminLogsController],
  providers: [AdminService, AdminUsersService, FeatureFlagsService, AdminLogsService],
  // Exported so other modules can gate behaviour on a flag (kill switches).
  exports: [FeatureFlagsService],
})
export class AdminModule {}
