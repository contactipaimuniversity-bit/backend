import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InscriptionsController } from './inscriptions.controller';
import { InscriptionsService } from './inscriptions.service';

@Module({
  imports: [AuthModule],
  controllers: [InscriptionsController],
  providers: [InscriptionsService],
})
export class InscriptionsModule {}
