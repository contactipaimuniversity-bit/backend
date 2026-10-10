import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { acteurDe } from '../common/acteur';
import { TAILLE_MAX_FICHIER } from '../fichiers/cloudinary.service';
import type { FichierRecu } from '../fichiers/cloudinary.service';
import { DocumentsService } from './documents.service';

@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get(':cible/:id')
  lister(
    @Param('cible') cible: string,
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.documents.lister(cible, id, acteurDe(request));
  }

  @Post(':cible/:id')
  @UseInterceptors(
    FileInterceptor('fichier', { limits: { fileSize: TAILLE_MAX_FICHIER } }),
  )
  ajouter(
    @Param('cible') cible: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @UploadedFile() fichier: FichierRecu | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.documents.ajouter(cible, id, body, fichier, acteurDe(request));
  }

  @Delete(':id')
  retirer(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.documents.retirer(id, body, acteurDe(request));
  }
}
