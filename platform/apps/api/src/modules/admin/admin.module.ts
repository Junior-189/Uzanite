import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { FeatureFlagsController } from './feature-flags.controller';
import { FeatureFlagsService } from './feature-flags.service';
import { AdminLogsController } from './admin-logs.controller';
import { AdminLogsService } from './admin-logs.service';
import { AdminQueuesController } from './admin-queues.controller';
import { AdminPrivacyController } from './admin-privacy.controller';
import { IdentityModule } from '../identity/identity.module';
import { PrivacyModule } from '../privacy/privacy.module';

@Module({
  imports: [IdentityModule, PrivacyModule],
  controllers: [AdminController, AdminUsersController, FeatureFlagsController, AdminLogsController, AdminQueuesController, AdminPrivacyController],
  providers: [AdminService, AdminUsersService, FeatureFlagsService, AdminLogsService],
  // Exported so other modules can gate behaviour on a flag (kill switches).
  exports: [FeatureFlagsService],
})
export class AdminModule {}
