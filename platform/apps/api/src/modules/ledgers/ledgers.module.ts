import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { ExpensesService } from './expenses.service';
import { ExpensesController } from './expenses.controller';
import { PurchasesService } from './purchases.service';
import { PurchasesController } from './purchases.controller';
import { DebtsService } from './debts.service';
import { DebtsController } from './debts.controller';

@Module({
  imports: [FilesModule],
  controllers: [ExpensesController, PurchasesController, DebtsController],
  providers: [ExpensesService, PurchasesService, DebtsService],
  exports: [ExpensesService, PurchasesService, DebtsService],
})
export class LedgersModule {}
