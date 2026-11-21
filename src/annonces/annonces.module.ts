import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AnnoncesController } from './annonces.controller';
import { AnnoncesService } from './annonces.service';
import { NotificationsPushService } from './notifications-push.service';

@Module({
  imports: [AuthModule],
  controllers: [AnnoncesController],
  providers: [AnnoncesService, NotificationsPushService],
  exports: [AnnoncesService, NotificationsPushService],
})
export class AnnoncesModule {}
