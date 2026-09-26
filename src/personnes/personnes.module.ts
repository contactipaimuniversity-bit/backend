import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PersonnesController } from './personnes.controller';
import { PersonnesService } from './personnes.service';

@Module({
  imports: [AuthModule],
  controllers: [PersonnesController],
  providers: [PersonnesService],
})
export class PersonnesModule {}
