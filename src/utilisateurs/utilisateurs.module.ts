import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UtilisateursController } from './utilisateurs.controller';
import { UtilisateursService } from './utilisateurs.service';

@Module({
  imports: [AuthModule],
  controllers: [UtilisateursController],
  providers: [UtilisateursService],
})
export class UtilisateursModule {}
