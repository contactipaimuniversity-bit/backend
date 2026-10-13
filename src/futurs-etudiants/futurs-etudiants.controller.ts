import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FutursEtudiantsService } from './futurs-etudiants.service';

type Body = Record<string, unknown>;

// Formulaire public des lycéens : sans connexion, il ne fait qu'ajouter une
// fiche et ne renvoie jamais de donnée enregistrée.
@Controller('enregistrements')
export class EnregistrementsController {
  constructor(private readonly futurs: FutursEtudiantsService) {}

  @Get('options')
  options() {
    return this.futurs.options();
  }

  @Post()
  @HttpCode(200)
  enregistrer(@Body() body: Body, @Req() request: Request) {
    // Derrière un relais, l'adresse d'origine arrive dans l'en-tête.
    const relais = request.headers['x-forwarded-for'];
    const adresse =
      (Array.isArray(relais) ? relais[0] : relais)?.split(',')[0].trim() ||
      request.ip ||
      '';
    return this.futurs.enregistrer(
      body && typeof body === 'object' ? body : {},
      adresse,
    );
  }
}

// Consultation des fiches par l'administration.
@Controller('futurs-etudiants')
@UseGuards(JwtAuthGuard)
export class FutursEtudiantsController {
  constructor(private readonly futurs: FutursEtudiantsService) {}

  @Get()
  liste(
    @Query()
    query: {
      q?: string;
      filiere?: string;
      contacte?: string;
      page?: string;
      limit?: string;
    },
  ) {
    return this.futurs.liste(query);
  }

  @Get('synthese')
  synthese() {
    return this.futurs.synthese();
  }

  @Patch(':id')
  marquerContacte(@Param('id') id: string, @Body() body: Body) {
    return this.futurs.marquerContacte(id, body);
  }

  @Delete(':id')
  supprimer(@Param('id') id: string) {
    return this.futurs.supprimer(id);
  }
}
