import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { acteurDe } from '../common/acteur';
import { PaieService } from './paie.service';
import { RhService } from './rh.service';

type Body = Record<string, unknown>;

// Dossiers du personnel, contrats, congés et absences.
@Controller('rh')
@UseGuards(JwtAuthGuard)
export class RhController {
  constructor(private readonly rh: RhService) {}

  @Get('parametres')
  parametres() {
    return this.rh.parametres();
  }

  @Patch('parametres')
  updateParametres(@Body() body: Body) {
    return this.rh.updateParametres(body);
  }

  @Get('tableau-de-bord')
  tableauDeBord() {
    return this.rh.tableauDeBord();
  }

  @Get('employes')
  employes(
    @Query()
    query: {
      q?: string;
      categorie?: string;
      statut?: string;
      page?: string;
      limit?: string;
    },
  ) {
    return this.rh.employes(query);
  }

  @Post('employes')
  createEmploye(@Body() body: Body) {
    return this.rh.createEmploye(body);
  }

  @Get('employes/:id')
  employe(@Param('id') id: string) {
    return this.rh.employe(id);
  }

  @Patch('employes/:id')
  updateEmploye(@Param('id') id: string, @Body() body: Body) {
    return this.rh.updateEmploye(id, body);
  }

  @Post('employes/:id/sortie')
  sortie(@Param('id') id: string, @Body() body: Body) {
    return this.rh.sortie(id, body);
  }

  @Post('employes/:id/reintegration')
  reintegrer(@Param('id') id: string) {
    return this.rh.reintegrer(id);
  }

  @Post('employes/:id/contrats')
  createContrat(
    @Param('id') id: string,
    @Body() body: Body,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.rh.createContrat(id, body, acteurDe(request));
  }

  @Post('contrats/:id/augmentation')
  augmenter(
    @Param('id') id: string,
    @Body() body: Body,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.rh.augmenter(id, body, acteurDe(request));
  }

  @Post('contrats/:id/fin')
  terminerContrat(@Param('id') id: string, @Body() body: Body) {
    return this.rh.terminerContrat(id, body);
  }

  @Get('conges/en-attente')
  congesEnAttente() {
    return this.rh.congesEnAttente();
  }

  @Post('employes/:id/conges')
  demanderConge(
    @Param('id') id: string,
    @Body() body: Body,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.rh.demanderConge(id, body, acteurDe(request));
  }

  @Post('conges/:id/decision')
  deciderConge(
    @Param('id') id: string,
    @Body() body: Body,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.rh.deciderConge(id, body, acteurDe(request));
  }

  @Post('conges/:id/annulation')
  annulerConge(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.rh.annulerConge(id, acteurDe(request));
  }

  @Post('employes/:id/absences')
  createAbsence(
    @Param('id') id: string,
    @Body() body: Body,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.rh.createAbsence(id, body, acteurDe(request));
  }

  @Delete('absences/:id')
  removeAbsence(@Param('id') id: string) {
    return this.rh.removeAbsence(id);
  }
}

// Paie : rubriques, périodes mensuelles, bulletins.
@Controller('paie')
@UseGuards(JwtAuthGuard)
export class PaieController {
  constructor(private readonly paie: PaieService) {}

  @Get('rubriques')
  rubriques() {
    return this.paie.rubriques();
  }

  @Post('rubriques')
  createRubrique(@Body() body: Body) {
    return this.paie.createRubrique(body);
  }

  @Patch('rubriques/:id')
  updateRubrique(@Param('id') id: string, @Body() body: Body) {
    return this.paie.updateRubrique(id, body);
  }

  @Put('employes/:id/rubriques')
  definirRubriqueEmploye(@Param('id') id: string, @Body() body: Body) {
    return this.paie.definirRubriqueEmploye(id, body);
  }

  @Get('periodes')
  periodes() {
    return this.paie.periodes();
  }

  @Post('periodes')
  createPeriode(@Body() body: Body, @Req() request: AuthenticatedRequest) {
    return this.paie.createPeriode(body, acteurDe(request));
  }

  @Get('periodes/:id')
  periode(@Param('id') id: string) {
    return this.paie.periode(id);
  }

  @Post('periodes/:id/recalculer')
  recalculer(@Param('id') id: string) {
    return this.paie.recalculer(id);
  }

  @Post('periodes/:id/valider')
  valider(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.paie.valider(id, acteurDe(request));
  }

  @Post('periodes/:id/rouvrir')
  rouvrir(@Param('id') id: string, @Body() body: Body) {
    return this.paie.rouvrir(id, body);
  }

  @Post('periodes/:id/payer')
  payer(
    @Param('id') id: string,
    @Body() body: Body,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.paie.payer(id, body, acteurDe(request));
  }

  @Post('periodes/:id/echeances')
  avancerEcheance(@Param('id') id: string, @Body() body: Body) {
    return this.paie.avancerEcheance(id, body);
  }

  @Patch('bulletins/:id')
  ajuster(@Param('id') id: string, @Body() body: Body) {
    return this.paie.ajuster(id, body);
  }

  @Get('bulletins/:id')
  bulletin(@Param('id') id: string) {
    return this.paie.bulletin(id);
  }
}
