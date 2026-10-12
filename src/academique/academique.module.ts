import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InscriptionsService } from '../inscriptions/inscriptions.service';
import {
  AcademiqueController,
  DeliberationsController,
  NotesController,
  ScolariteController,
} from './academique.controller';
import { DeliberationsService } from './deliberations.service';
import { EvaluationsService } from './evaluations.service';
import { ScolariteService } from './scolarite.service';
import { StatistiquesAcademiquesService } from './statistiques.service';
import { StructureService } from './structure.service';
import { TableauAcademiqueService } from './tableau.service';

@Module({
  imports: [AuthModule],
  controllers: [
    AcademiqueController,
    ScolariteController,
    NotesController,
    DeliberationsController,
  ],
  providers: [
    StructureService,
    ScolariteService,
    EvaluationsService,
    DeliberationsService,
    StatistiquesAcademiquesService,
    TableauAcademiqueService,
    // Les réinscriptions passent par le circuit normal d'inscription.
    InscriptionsService,
  ],
})
export class AcademiqueModule {}
