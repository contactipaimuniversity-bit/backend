import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ComptabiliteController } from './comptabilite.controller';
import { ComptabiliteService } from './comptabilite.service';

@Module({
  imports: [AuthModule],
  controllers: [ComptabiliteController],
  providers: [ComptabiliteService],
})
export class ComptabiliteModule {}
