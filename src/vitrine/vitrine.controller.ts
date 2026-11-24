import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { acteurDe } from '../common/acteur';
import {
  TAILLE_MAX_FICHIER,
  type FichierRecu,
} from '../fichiers/cloudinary.service';
import { VitrineService } from './vitrine.service';

type Corps = Record<string, unknown>;
const image = () =>
  FileInterceptor('image', { limits: { fileSize: TAILLE_MAX_FICHIER } });

// Vitrine publique : sans connexion, elle ne lit que les diapositives actives.
@Controller('vitrine')
export class VitrinePubliqueController {
  constructor(private readonly vitrine: VitrineService) {}

  @Get('diapositives')
  @Header('Cache-Control', 'public, max-age=60')
  diapositives() {
    return this.vitrine.publiques();
  }

  // L'adresse change à chaque modification (?v=...) : l'image se garde longtemps.
  @Get('diapositives/:id/image')
  @Header('Cache-Control', 'public, max-age=604800, immutable')
  async image(@Param('id') id: string) {
    const { contenu, type } = await this.vitrine.lireImage(id);
    return new StreamableFile(contenu, { type });
  }
}

// Gestion du carrousel par l'administration.
@Controller('vitrine/gestion')
@UseGuards(JwtAuthGuard)
export class VitrineGestionController {
  constructor(private readonly vitrine: VitrineService) {}

  @Get('diapositives')
  liste() {
    return this.vitrine.liste();
  }

  @Post('diapositives')
  @UseInterceptors(image())
  creer(
    @Body() body: Corps,
    @UploadedFile() fichier: FichierRecu | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.vitrine.creer(body ?? {}, fichier, acteurDe(request));
  }

  @Patch('diapositives/:id')
  @UseInterceptors(image())
  modifier(
    @Param('id') id: string,
    @Body() body: Corps,
    @UploadedFile() fichier: FichierRecu | undefined,
  ) {
    return this.vitrine.modifier(id, body ?? {}, fichier);
  }

  @Delete('diapositives/:id')
  supprimer(@Param('id') id: string) {
    return this.vitrine.supprimer(id);
  }

  @Post('ordre')
  ordonner(@Body() body: Corps) {
    return this.vitrine.ordonner(body ?? {});
  }
}
