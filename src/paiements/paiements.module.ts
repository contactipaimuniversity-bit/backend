import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaiementsController } from './paiements.controller';
import { PaiementsService } from './paiements.service';

@Module({
  imports: [AuthModule],
  controllers: [PaiementsController],
  providers: [PaiementsService],
})
export class PaiementsModule {}
