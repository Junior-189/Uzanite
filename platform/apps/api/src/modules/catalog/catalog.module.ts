import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { StockService } from './stock.service';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { FilesModule } from '../files/files.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [FilesModule, BillingModule],
  controllers: [ProductsController, CategoriesController],
  providers: [ProductsService, StockService, CategoriesService],
  exports: [ProductsService, StockService],
})
export class CatalogModule {}
