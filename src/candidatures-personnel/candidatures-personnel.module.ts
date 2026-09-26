import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CandidaturesPersonnelController } from './candidatures-personnel.controller';
import { CandidaturesPersonnelService } from './candidatures-personnel.service';

@Module({
  imports: [AuthModule],
  controllers: [CandidaturesPersonnelController],
  providers: [CandidaturesPersonnelService],
})
export class CandidaturesPersonnelModule {}
