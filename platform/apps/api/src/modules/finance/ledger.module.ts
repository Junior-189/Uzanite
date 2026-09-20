import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';

// Low-level financial primitive with no domain dependencies, so both Commerce
// (cash sales) and Finance (payments/refunds) can write to the ledger without a
// circular module dependency.
@Module({
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
