import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { UnitOfWorkService } from './unit-of-work.service';

@Global()
@Module({
  providers: [PrismaService, UnitOfWorkService],
  exports: [PrismaService, UnitOfWorkService],
})
export class PrismaModule {}
