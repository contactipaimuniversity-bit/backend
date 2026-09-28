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
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
})
export class AppModule {}
