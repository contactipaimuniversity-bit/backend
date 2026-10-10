import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ImpressionsController } from './impressions.controller';
import { ImpressionsService } from './impressions.service';

@Module({
  imports: [AuthModule],
  controllers: [ImpressionsController],
  providers: [ImpressionsService],
})
export class ImpressionsModule {}
