import { Module } from '@nestjs/common';
import { ReceiptsService } from './receipts.service';
import { ReceiptsController } from './receipts.controller';
import { ReceiptPdfService } from './receipt-pdf.service';

@Module({
  controllers: [ReceiptsController],
  providers: [ReceiptsService, ReceiptPdfService],
  exports: [ReceiptsService],
})
export class ReceiptsModule {}
