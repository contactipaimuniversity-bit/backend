import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreatePaiementDto } from './dto/create-paiement.dto';
import { PaiementsService } from './paiements.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class PaiementsController {
  constructor(private readonly paiementsService: PaiementsService) {}

  @Post('paiements')
  create(@Body() createDto: CreatePaiementDto) {
    return this.paiementsService.create(createDto);
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
