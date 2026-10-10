import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { DemandesBourseModule } from './demandes-bourse/demandes-bourse.module';
import { ElementsRequisModule } from './elements-requis/elements-requis.module';
import { InscriptionsModule } from './inscriptions/inscriptions.module';
import { PaiementsModule } from './paiements/paiements.module';
import { PersonnesModule } from './personnes/personnes.module';
import { ProspectsModule } from './prospects/prospects.module';
import { PrismaModule } from './prisma/prisma.module';
import { RapportsModule } from './rapports/rapports.module';
import { TypesBourseModule } from './types-bourse/types-bourse.module';
import { UtilisateursModule } from './utilisateurs/utilisateurs.module';
import { CandidaturesPersonnelModule } from './candidatures-personnel/candidatures-personnel.module';
import { IdempotencyInterceptor } from './idempotency/idempotency.interceptor';
import { CorbeilleModule } from './corbeille/corbeille.module';
import { AuditModule } from './audit/audit.module';
import { HealthModule } from './health/health.module';
import { DepensesModule } from './depenses/depenses.module';
import { ImpressionsModule } from './impressions/impressions.module';
import { AcademiqueModule } from './academique/academique.module';
import { RhModule } from './rh/rh.module';
import { ComptabiliteModule } from './comptabilite/comptabilite.module';
import { DocumentsModule } from './documents/documents.module';
import { SauvegardesModule } from './sauvegardes/sauvegardes.module';
import { AuditInterceptor } from './audit/audit.interceptor';
import { VersionInterceptor } from './common/version.interceptor';
import { SynchronisationModule } from './synchronisation/synchronisation.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    DemandesBourseModule,
    ElementsRequisModule,
    InscriptionsModule,
    PaiementsModule,
    UtilisateursModule,
    PersonnesModule,
    ProspectsModule,
    RapportsModule,
    TypesBourseModule,
    CandidaturesPersonnelModule,
    CorbeilleModule,
    AuditModule,
    HealthModule,
    DepensesModule,
    ImpressionsModule,
    AcademiqueModule,
    RhModule,
    ComptabiliteModule,
    DocumentsModule,
    SauvegardesModule,
    SynchronisationModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // L'audit enveloppe l'idempotence : il voit le résultat final de chaque écriture.
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: VersionInterceptor },
  ],
})
export class AppModule {}
