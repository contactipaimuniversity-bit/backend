import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/guards/admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RapportsService } from './rapports.service';
import { PeriodeRapportDto } from './dto/periode-rapport.dto';

@Controller('rapports')
@UseGuards(JwtAuthGuard, AdminGuard)
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

  @Get('synthese')
  synthese() {
    return this.rapportsService.synthese();
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
