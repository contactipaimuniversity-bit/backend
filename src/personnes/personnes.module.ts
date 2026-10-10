import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CloudinaryService } from '../fichiers/cloudinary.service';
import { PersonnesController } from './personnes.controller';
import { PersonnesService } from './personnes.service';

@Module({
  imports: [AuthModule],
  controllers: [PersonnesController],
  providers: [PersonnesService, CloudinaryService],
})
export class PersonnesModule {}
