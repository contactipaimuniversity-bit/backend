import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SynchronisationController } from './synchronisation.controller';
import { SynchronisationService } from './synchronisation.service';

@Module({
  imports: [AuthModule],
  controllers: [SynchronisationController],
  providers: [SynchronisationService],
})
export class SynchronisationModule {}
