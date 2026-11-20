import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AnnoncesController } from './annonces.controller';
import { AnnoncesService } from './annonces.service';

@Module({
  imports: [AuthModule],
  controllers: [AnnoncesController],
  providers: [AnnoncesService],
  exports: [AnnoncesService],
})
export class AnnoncesModule {}
