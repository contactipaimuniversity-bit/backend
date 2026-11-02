import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { acteurDe } from '../common/acteur';
import { RapportsService } from './rapports.service';
import { PeriodeRapportDto } from './dto/periode-rapport.dto';

@Controller('rapports')
@UseGuards(JwtAuthGuard)
export class RapportsController {
  constructor(private readonly rapportsService: RapportsService) {}

  @Get('dossiers-incomplets')
  dossiersIncomplets() {
    return this.rapportsService.dossiersIncomplets();
  }

  @Get('paiements-en-retard')
  paiementsEnRetard() {
    return this.rapportsService.paiementsEnRetard();
  }

  @Get('recouvrement')
  recouvrement(
    @Query()
    query: {
      type?: string;
      statut?: string;
      anneeScolaire?: string;
      q?: string;
      page?: string;
      limit?: string;
    },
  ) {
    return this.rapportsService.recouvrement(query);
  }

  @Get('synthese')
  synthese(@Req() request: AuthenticatedRequest) {
    return this.rapportsService.syntheseVisible(acteurDe(request));
  }

  @Get('a-faire')
  aFaire(@Req() request: AuthenticatedRequest) {
    return this.rapportsService.aFaireVisible(acteurDe(request));
  }

  @Get('activite-periode')
  activitePeriode(@Query() periode: PeriodeRapportDto) {
    return this.rapportsService.activitePeriode(periode);
  }

  @Get('activite-journee')
  activiteJournee(@Query('date') date: string) {
    return this.rapportsService.activiteJournee(date);
  }
}
