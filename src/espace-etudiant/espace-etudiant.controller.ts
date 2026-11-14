import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { acteurDe } from '../common/acteur';
import { EspaceEtudiantService } from './espace-etudiant.service';
import { EtudiantGuard, type RequeteEtudiant } from './etudiant.guard';

type Corps = Record<string, unknown>;

// Connexion à l'espace étudiant : routes publiques.
@Controller('etudiant/auth')
export class EtudiantAuthController {
  constructor(private readonly service: EspaceEtudiantService) {}

  @Post('connexion')
  @HttpCode(200)
  connexion(@Body() body: Corps) {
    return this.service.connexion(body);
  }

  @Post('activation')
  @HttpCode(200)
  activation(@Body() body: Corps) {
    return this.service.activation(body);
  }
}

// Données de l'étudiant connecté : jamais d'identifiant venu du client.
@Controller('etudiant/moi')
@UseGuards(EtudiantGuard)
export class EtudiantController {
  constructor(private readonly service: EspaceEtudiantService) {}

  @Get()
  profil(@Req() request: RequeteEtudiant) {
    return this.service.profil(request.etudiant.personneId);
  }

  @Get('photo')
  @Header('Cache-Control', 'private, max-age=86400')
  async photo(@Req() request: RequeteEtudiant) {
    const { contenu, type } = await this.service.photo(
      request.etudiant.personneId,
    );
    return new StreamableFile(contenu, { type });
  }

  @Get('emploi-du-temps')
  emploiDuTemps(@Req() request: RequeteEtudiant) {
    return this.service.emploiDuTemps(request.etudiant.personneId);
  }

  @Get('examens')
  examens(@Req() request: RequeteEtudiant) {
    return this.service.examens(request.etudiant.personneId);
  }

  @Get('carte')
  carte(@Req() request: RequeteEtudiant) {
    return this.service.carte(request.etudiant.personneId);
  }

  @Get('scolarite')
  scolarite(@Req() request: RequeteEtudiant) {
    return this.service.scolarite(request.etudiant.personneId);
  }

  @Get('assiduite')
  assiduite(@Req() request: RequeteEtudiant) {
    return this.service.assiduite(request.etudiant.personneId);
  }

  @Get('notes')
  notes(@Req() request: RequeteEtudiant) {
    return this.service.notes(request.etudiant.personneId);
  }

  @Post('mot-de-passe')
  @HttpCode(200)
  motDePasse(@Req() request: RequeteEtudiant, @Body() body: Corps) {
    return this.service.changerMotDePasse(request.etudiant.compteId, body);
  }
}

// Côté administration : remettre un code d'accès, fermer un compte.
@Controller('comptes-etudiants')
@UseGuards(JwtAuthGuard)
export class ComptesEtudiantsController {
  constructor(private readonly service: EspaceEtudiantService) {}

  @Get(':personneId')
  statut(@Param('personneId') personneId: string) {
    return this.service.statutCompte(personneId);
  }

  @Post(':personneId/code')
  code(
    @Param('personneId') personneId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.genererCode(personneId, acteurDe(request).nom);
  }

  @Post(':personneId/desactivation')
  desactiver(@Param('personneId') personneId: string) {
    return this.service.desactiver(personneId);
  }
}
