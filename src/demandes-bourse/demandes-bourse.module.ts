import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DemandesBourseController } from './demandes-bourse.controller';
import { DemandesBourseService } from './demandes-bourse.service';

@Module({
  imports: [AuthModule],
  controllers: [DemandesBourseController],
  providers: [DemandesBourseService],
})
export class DemandesBourseModule {}
