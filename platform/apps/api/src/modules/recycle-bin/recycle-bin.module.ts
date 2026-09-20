import { Module } from '@nestjs/common';
import { RecycleBinService } from './recycle-bin.service';
import { RecycleBinController } from './recycle-bin.controller';
import { CommerceModule } from '../commerce/commerce.module';
import { CatalogModule } from '../catalog/catalog.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [CommerceModule, CatalogModule, NotificationsModule],
  controllers: [RecycleBinController],
  providers: [RecycleBinService],
})
export class RecycleBinModule {}
