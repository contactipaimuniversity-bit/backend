import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TypesBourseController } from './types-bourse.controller';
import { TypesBourseService } from './types-bourse.service';

@Module({
  imports: [AuthModule],
  controllers: [TypesBourseController],
  providers: [TypesBourseService],
})
export class TypesBourseModule {}
