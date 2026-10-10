import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { createReadStream } from 'node:fs';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { AdminGuard } from '../auth/guards/admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { acteurDe } from '../common/acteur';
import { SauvegardesService } from './sauvegardes.service';

// Une sauvegarde contient toutes les données : réservé aux administrateurs.
@Controller('sauvegardes')
@UseGuards(JwtAuthGuard, AdminGuard)
export class SauvegardesController {
  constructor(private readonly sauvegardes: SauvegardesService) {}

  @Get()
  lister() {
    return this.sauvegardes.lister();
  }

  @Post()
  creer(@Req() request: AuthenticatedRequest) {
    return this.sauvegardes.creer('MANUEL', acteurDe(request).nom);
  }

  @Post(':id/test')
  tester(@Param('id') id: string) {
    return this.sauvegardes.tester(id);
  }

  @Post(':id/copie-externe')
  recopier(@Param('id') id: string) {
    return this.sauvegardes.recopier(id);
  }

  @Get(':id/fichier')
  async telecharger(@Param('id') id: string) {
    const { sauvegarde, chemin } = await this.sauvegardes.telecharger(id);
    return new StreamableFile(createReadStream(chemin), {
      type: 'application/gzip',
      disposition: `attachment; filename="${sauvegarde.fichier}"`,
    });
  }
}
