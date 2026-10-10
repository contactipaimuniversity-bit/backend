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
import { ComptabiliteService } from './comptabilite.service';

type Body = Record<string, unknown>;
type Periode = { du?: string; au?: string; exerciceId?: string };

@Controller('comptabilite')
@UseGuards(JwtAuthGuard)
export class ComptabiliteController {
  constructor(private readonly comptabilite: ComptabiliteService) {}

  @Get('comptes')
  comptes() {
    return this.comptabilite.comptes();
  }

  @Post('comptes')
  createCompte(@Body() body: Body) {
    return this.comptabilite.createCompte(body);
  }

  @Patch('comptes/:id')
  updateCompte(@Param('id') id: string, @Body() body: Body) {
    return this.comptabilite.updateCompte(id, body);
  }

  @Get('journal')
  journal(
    @Query()
    query: Periode & {
      journal?: string;
      statut?: string;
      q?: string;
      page?: string;
      limit?: string;
    },
  ) {
    return this.comptabilite.journal(query);
  }

  @Get('balance')
  balance(@Query() query: Periode) {
    return this.comptabilite.balance(query);
  }

  @Get('grand-livre')
  grandLivre(@Query() query: { compte?: string; du?: string; au?: string }) {
    return this.comptabilite.grandLivre(query);
  }

  @Get('etats')
  etats(@Query() query: Periode) {
    return this.comptabilite.etats(query);
  }

  @Post('ecritures')
  createEcriture(@Body() body: Body, @Req() request: AuthenticatedRequest) {
    return this.comptabilite.createEcriture(body, acteurDe(request));
  }

  @Delete('ecritures/:id')
  removeEcriture(@Param('id') id: string) {
    return this.comptabilite.removeEcriture(id);
  }

  @Post('ecritures/:id/valider')
  validerEcriture(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.comptabilite.validerEcriture(id, acteurDe(request));
  }

  @Post('ecritures/:id/extourner')
  extournerEcriture(
    @Param('id') id: string,
    @Body() body: Body,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.comptabilite.extournerEcriture(id, body, acteurDe(request));
  }
}
