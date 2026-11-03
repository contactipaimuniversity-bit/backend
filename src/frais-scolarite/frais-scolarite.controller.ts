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
import { FraisScolariteService } from './frais-scolarite.service';

type Corps = Record<string, unknown>;

@Controller('frais-scolarite')
@UseGuards(JwtAuthGuard)
export class FraisScolariteController {
  constructor(private readonly service: FraisScolariteService) {}

  @Get('parametres')
  parametres(@Query('annee') annee?: string) {
    return this.service.parametres(annee);
  }

  @Put('calendrier')
  calendrier(@Body() body: Corps) {
    return this.service.enregistrerCalendrier(body);
  }

  @Put('tarifs')
  tarifs(@Body() body: Corps) {
    return this.service.enregistrerTarifs(body);
  }

  @Post('bourses')
  creerBourse(@Body() body: Corps) {
    return this.service.creerBourse(body);
  }

  @Get('bourses/a-confirmer')
  aConfirmer() {
    return this.service.boursesAConfirmer();
  }

  @Post('bourses/decision')
  decision(@Body() body: Corps, @Req() request: AuthenticatedRequest) {
    return this.service.deciderBourse(body, acteurDe(request).nom);
  }

  @Put('bourses/:id')
  modifierBourse(@Param('id') id: string, @Body() body: Corps) {
    return this.service.modifierBourse(id, body);
  }

  @Post('annexes')
  creerAnnexe(@Body() body: Corps) {
    return this.service.creerAnnexe(body);
  }

  @Put('annexes/:id')
  modifierAnnexe(@Param('id') id: string, @Body() body: Corps) {
    return this.service.modifierAnnexe(id, body);
  }

  @Patch('annexes/:id/actif')
  activerAnnexe(@Param('id') id: string, @Body() body: Corps) {
    return this.service.activerAnnexe(id, body);
  }

  @Post('appliquer')
  appliquer(@Body() body: Corps) {
    return this.service.appliquer(body);
  }

  @Get('inscriptions/:id')
  situation(@Param('id') id: string) {
    return this.service.situation(id);
  }

  @Post('inscriptions/:id/reduction')
  reduction(@Param('id') id: string, @Body() body: Corps) {
    return this.service.accorderReduction(id, body);
  }

  @Post('inscriptions/:id/nombre-mois')
  nombreMois(@Param('id') id: string, @Body() body: Corps) {
    return this.service.limiterMois(id, body);
  }

  @Post('inscriptions/:id/reinitialiser')
  reinitialiser(@Param('id') id: string) {
    return this.service.reinitialiser(id);
  }

  @Post('inscriptions/:id/retablir-bourse')
  retablirBourse(@Param('id') id: string) {
    return this.service.retablirBourse(id);
  }

  @Post('inscriptions/:id/annexes')
  ajouterAnnexe(@Param('id') id: string, @Body() body: Corps) {
    return this.service.ajouterAnnexe(id, body);
  }

  @Post('inscriptions/:id/lignes')
  ajouterLigne(@Param('id') id: string, @Body() body: Corps) {
    return this.service.ajouterLigne(id, body);
  }

  @Put('inscriptions/:id/lignes/:ligneId')
  modifierLigne(
    @Param('id') id: string,
    @Param('ligneId') ligneId: string,
    @Body() body: Corps,
  ) {
    return this.service.modifierLigne(id, ligneId, body);
  }

  @Post('inscriptions/:id/exceptions')
  accorderException(
    @Param('id') id: string,
    @Body() body: Corps,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.accorderException(id, body, acteurDe(request).nom);
  }

  @Delete('inscriptions/:id/exceptions/:exceptionId')
  retirerException(
    @Param('id') id: string,
    @Param('exceptionId') exceptionId: string,
  ) {
    return this.service.retirerException(id, exceptionId);
  }

  @Delete('inscriptions/:id/lignes/:ligneId')
  retirerLigne(@Param('id') id: string, @Param('ligneId') ligneId: string) {
    return this.service.retirerLigne(id, ligneId);
  }
}
