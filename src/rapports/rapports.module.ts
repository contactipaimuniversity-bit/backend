import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RapportsController } from './rapports.controller';
import { RapportsService } from './rapports.service';

@Module({
  imports: [AuthModule],
  controllers: [RapportsController],
  providers: [RapportsService],
})
export class RapportsModule {}
