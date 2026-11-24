import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CloudinaryService } from '../fichiers/cloudinary.service';
import {
  VitrineGestionController,
  VitrinePubliqueController,
} from './vitrine.controller';
import { VitrineService } from './vitrine.service';

@Module({
  imports: [AuthModule],
  controllers: [VitrinePubliqueController, VitrineGestionController],
  providers: [VitrineService, CloudinaryService],
})
export class VitrineModule {}
