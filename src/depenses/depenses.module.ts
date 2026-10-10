import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CloudinaryService } from '../fichiers/cloudinary.service';
import { ComptabiliteService } from '../comptabilite/comptabilite.service';
import { DepensesController } from './depenses.controller';
import { DepensesService } from './depenses.service';
import { FinancesController } from './finances.controller';
import { FinancesService } from './finances.service';

@Module({
  imports: [AuthModule],
  controllers: [DepensesController, FinancesController],
  providers: [
    DepensesService,
    FinancesService,
    CloudinaryService,
    ComptabiliteService,
  ],
})
export class DepensesModule {}
