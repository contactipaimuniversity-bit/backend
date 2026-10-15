import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { acteurDe } from '../common/acteur';
import { saisieLocale } from '../common/saisie-locale';
import {
  RembourserTropPercuDto,
  ReporterTropPercuDto,
} from './dto/trop-percu.dto';
import { AnnulerPaiementDto } from './dto/annuler-paiement.dto';
import { CreatePaiementDto } from './dto/create-paiement.dto';
import { AssignPaiementDto } from './dto/assign-paiement.dto';
import { PaiementsService } from './paiements.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class PaiementsController {
  constructor(private readonly paiementsService: PaiementsService) {}

  @Post('paiements')
  create(
    @Body() createDto: CreatePaiementDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.paiementsService.create(
      createDto,
      saisieLocale(request),
      acteurDe(request).nom,
    );
  }

  @Get('paiements')
  findAll(
    @Query('ordreDate') ordreDate?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    return this.paiementsService.findAll(ordreDate, q, limit);
  }

  @Get('paiements/non-affectes')
  findUnassigned() {
    return this.paiementsService.findUnassigned();
  }

  @Patch('paiements/:id/affectation')
  assignToElement(@Param('id') id: string, @Body() dto: AssignPaiementDto) {
    return this.paiementsService.assignToElement(id, dto.elementDossierId);
  }

  // Encaissement saisi par erreur : il est neutralisé par une ligne inverse, jamais effacé.
  @Post('paiements/:id/annulation')
  annuler(
    @Param('id') id: string,
    @Body() dto: AnnulerPaiementDto | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.paiementsService.annuler(id, dto ?? {}, acteurDe(request).nom);
  }

  // Régularisation d'un trop-perçu : report sur une autre obligation, ou remboursement.
  @Post('paiements/reports')
  reporterTropPercu(
    @Body() dto: ReporterTropPercuDto | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.paiementsService.reporterTropPercu(
      dto ?? {},
      acteurDe(request).nom,
    );
  }

  @Post('paiements/remboursements')
  rembourserTropPercu(
    @Body() dto: RembourserTropPercuDto | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.paiementsService.rembourserTropPercu(
      dto ?? {},
      acteurDe(request).nom,
    );
  }

  @Get('demandes-bourse/:id/paiements')
  findByDemandeBourse(@Param('id') id: string) {
    return this.paiementsService.findByDemandeBourse(id);
  }

  @Get('inscriptions/:id/paiements')
  findByInscription(@Param('id') id: string) {
    return this.paiementsService.findByInscription(id);
  }

  @Get('paiements/solde/:dossierType/:dossierId')
  solde(
    @Param('dossierType') dossierType: string,
    @Param('dossierId') dossierId: string,
  ) {
    return this.paiementsService.solde(dossierType, dossierId);
  }
}
