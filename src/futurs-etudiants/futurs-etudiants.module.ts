import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  EnregistrementsController,
  FutursEtudiantsController,
} from './futurs-etudiants.controller';
import { FutursEtudiantsService } from './futurs-etudiants.service';

@Module({
  imports: [AuthModule],
  controllers: [EnregistrementsController, FutursEtudiantsController],
  providers: [FutursEtudiantsService],
})
export class FutursEtudiantsModule {}
