import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FraisScolariteController } from './frais-scolarite.controller';
import { FraisScolariteService } from './frais-scolarite.service';

@Module({
  imports: [AuthModule],
  controllers: [FraisScolariteController],
  providers: [FraisScolariteService],
})
export class FraisScolariteModule {}
