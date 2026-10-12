import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { acteurDe } from '../common/acteur';
import { PointageService } from './pointage.service';

type Body = Record<string, unknown>;

// Pointage du personnel et émargement des enseignants.
@Controller('rh/pointage')
@UseGuards(JwtAuthGuard)
export class PointageController {
  constructor(private readonly pointage: PointageService) {}

  @Get('personnel')
  personnel(@Query('date') date?: string) {
    return this.pointage.personnel(date);
  }

  @Get('personnel/recapitulatif')
  recapPersonnel(@Query() query: { annee?: string; mois?: string }) {
    return this.pointage.recapPersonnel(query);
  }

  @Put('personnel/:employeId')
  pointer(
    @Param('employeId') employeId: string,
    @Body() body: Body,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.pointage.pointer(employeId, body, acteurDe(request));
  }

  @Post('personnel/:employeId/absence')
  noterAbsent(
    @Param('employeId') employeId: string,
    @Body() body: Body,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.pointage.noterAbsent(employeId, body, acteurDe(request));
  }

  @Delete('personnel/:employeId')
  effacer(@Param('employeId') employeId: string, @Query('date') date?: string) {
    return this.pointage.effacer(employeId, date);
  }

  @Get('enseignants')
  enseignants(@Query('date') date?: string) {
    return this.pointage.enseignants(date);
  }

  @Get('enseignants/recapitulatif')
  recapEnseignants(@Query() query: { annee?: string; mois?: string }) {
    return this.pointage.recapEnseignants(query);
  }

  @Post('enseignants/presence')
  marquerPresent(@Body() body: Body, @Req() request: AuthenticatedRequest) {
    return this.pointage.marquerPresent(body, acteurDe(request));
  }

  @Post('enseignants/absence')
  marquerAbsent(@Body() body: Body, @Req() request: AuthenticatedRequest) {
    return this.pointage.marquerAbsent(body, acteurDe(request));
  }

  @Delete('enseignants/:creneauId')
  annulerEmargement(
    @Param('creneauId') creneauId: string,
    @Query('date') date?: string,
  ) {
    return this.pointage.annulerEmargement(creneauId, date);
  }
}
