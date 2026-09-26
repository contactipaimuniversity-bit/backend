import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProspectsController } from './prospects.controller';
import { ProspectsService } from './prospects.service';

@Module({
  imports: [AuthModule],
  controllers: [ProspectsController],
  providers: [ProspectsService],
})
export class ProspectsModule {}
