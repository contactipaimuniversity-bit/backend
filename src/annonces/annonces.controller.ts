import {
  Body,
  Controller,
  Delete,
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
import { AnnoncesService } from './annonces.service';

type Corps = Record<string, unknown>;

// Annonces aux étudiants, côté administration.
@Controller('annonces')
@UseGuards(JwtAuthGuard)
export class AnnoncesController {
  constructor(private readonly annonces: AnnoncesService) {}

  @Get()
  liste() {
    return this.annonces.liste();
  }

  @Get('etudiants')
  etudiants(@Query('q') q?: string) {
    return this.annonces.etudiants(q);
  }

  @Get('cibles')
  cibles() {
    return this.annonces.cibles();
  }

  @Post()
  creer(@Body() body: Corps, @Req() request: AuthenticatedRequest) {
    return this.annonces.creer(body, acteurDe(request));
  }

  @Patch(':id')
  modifier(@Param('id') id: string, @Body() body: Corps) {
    return this.annonces.modifier(id, body);
  }

  @Delete(':id')
  supprimer(@Param('id') id: string) {
    return this.annonces.supprimer(id);
  }
}
