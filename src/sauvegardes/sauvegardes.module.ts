import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CloudinaryService } from '../fichiers/cloudinary.service';
import { SauvegardesController } from './sauvegardes.controller';
import { SauvegardesService } from './sauvegardes.service';

@Module({
  imports: [AuthModule],
  controllers: [SauvegardesController],
  providers: [SauvegardesService, CloudinaryService],
})
export class SauvegardesModule {}
