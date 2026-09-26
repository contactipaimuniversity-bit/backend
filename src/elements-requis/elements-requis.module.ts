import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ElementsRequisController } from './elements-requis.controller';
import { ElementsRequisService } from './elements-requis.service';

@Module({
  imports: [AuthModule],
  controllers: [ElementsRequisController],
  providers: [ElementsRequisService],
})
export class ElementsRequisModule {}
