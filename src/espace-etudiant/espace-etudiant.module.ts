import { Module } from '@nestjs/common';
import { DeliberationsService } from '../academique/deliberations.service';
import { StructureService } from '../academique/structure.service';
import { AuthModule } from '../auth/auth.module';
import { CloudinaryService } from '../fichiers/cloudinary.service';
import { InscriptionsService } from '../inscriptions/inscriptions.service';
import {
  ComptesEtudiantsController,
  EtudiantAuthController,
  EtudiantController,
} from './espace-etudiant.controller';
import { EspaceEtudiantService } from './espace-etudiant.service';
import { EtudiantGuard } from './etudiant.guard';

// Espace étudiant (application mobile installable).
@Module({
  imports: [AuthModule],
  controllers: [
    EtudiantAuthController,
    EtudiantController,
    ComptesEtudiantsController,
  ],
  providers: [
    EspaceEtudiantService,
    EtudiantGuard,
    StructureService,
    DeliberationsService,
    InscriptionsService,
    CloudinaryService,
  ],
})
export class EspaceEtudiantModule {}
