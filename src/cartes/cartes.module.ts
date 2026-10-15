import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CartesController } from './cartes.controller';
import { CartesService } from './cartes.service';

@Module({
  imports: [AuthModule],
  controllers: [CartesController],
  providers: [CartesService],
})
export class CartesModule {}
