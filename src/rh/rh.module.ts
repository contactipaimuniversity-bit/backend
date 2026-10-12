import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaieService } from './paie.service';
import { PointageController } from './pointage.controller';
import { PointageService } from './pointage.service';
import { PaieController, RhController } from './rh.controller';
import { RhService } from './rh.service';

@Module({
  imports: [AuthModule],
  controllers: [RhController, PaieController, PointageController],
  providers: [RhService, PaieService, PointageService],
})
export class RhModule {}
