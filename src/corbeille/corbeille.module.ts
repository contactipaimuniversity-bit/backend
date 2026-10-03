import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CorbeilleController } from './corbeille.controller';
import { CorbeilleService } from './corbeille.service';

@Module({
  imports: [AuthModule],
  controllers: [CorbeilleController],
  providers: [CorbeilleService],
})
export class CorbeilleModule {}