import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AnnoncesController } from './annonces.controller';
import { AnnoncesService } from './annonces.service';
import { NotificationsPushService } from './notifications-push.service';
import { RappelsService } from './rappels.service';

@Module({
  imports: [AuthModule],
  controllers: [AnnoncesController],
  providers: [AnnoncesService, NotificationsPushService, RappelsService],
  exports: [AnnoncesService, NotificationsPushService],
})
export class AnnoncesModule {}
