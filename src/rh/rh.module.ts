import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaieService } from './paie.service';
import { PaieController, RhController } from './rh.controller';
import { RhService } from './rh.service';

@Module({
  imports: [AuthModule],
  controllers: [RhController, PaieController],
  providers: [RhService, PaieService],
})
export class RhModule {}
