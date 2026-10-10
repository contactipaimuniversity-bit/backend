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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TAILLE_MAX_FICHIER } from '../fichiers/cloudinary.service';
import type { FichierRecu } from '../fichiers/cloudinary.service';
import { acteurDe } from './acteur';
import { DepensesService } from './depenses.service';
import type { DepenseBody } from './depenses.service';

const fichier = () =>
  FileInterceptor('fichier', { limits: { fileSize: TAILLE_MAX_FICHIER } });

@Controller('depenses')
@UseGuards(JwtAuthGuard)
export class DepensesController {
  constructor(private readonly depensesService: DepensesService) {}

  @Get()
  findAll(
    @Req() request: AuthenticatedRequest,
    @Query()
    query: {
      vue?: string;
      statut?: string;
      q?: string;
      page?: string;
      limit?: string;
    },
  ) {
    return this.depensesService.findAll(acteurDe(request), query);
  }

  @Get('a-valider')
  aValider(@Req() request: AuthenticatedRequest) {
    return this.depensesService.aValider(acteurDe(request));
  }

  @Get('a-executer')
  aExecuter(@Req() request: AuthenticatedRequest) {
    return this.depensesService.aExecuter(acteurDe(request));
  }

  @Get('compteurs')
  compteurs(@Req() request: AuthenticatedRequest) {
    return this.depensesService.compteurs(acteurDe(request));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.depensesService.findOne(id, acteurDe(request));
  }

  @Post()
  create(@Body() body: DepenseBody, @Req() request: AuthenticatedRequest) {
    return this.depensesService.create(body, acteurDe(request));
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: DepenseBody,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.depensesService.update(id, body, acteurDe(request));
  }

  @Post(':id/pieces')
  @UseInterceptors(fichier())
  addPiece(
    @Param('id') id: string,
    @Body() body: { type?: string },
    @UploadedFile() file: FichierRecu | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.depensesService.addPiece(
      id,
      body.type,
      file,
      acteurDe(request),
    );
  }

  @Delete(':id/pieces/:pieceId')
  removePiece(
    @Param('id') id: string,
    @Param('pieceId') pieceId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.depensesService.removePiece(id, pieceId, acteurDe(request));
  }

  @Post(':id/soumettre')
  soumettre(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.depensesService.soumettre(id, acteurDe(request));
  }

  @Post(':id/valider')
  valider(
    @Param('id') id: string,
    @Body() body: { commentaire?: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.depensesService.valider(
      id,
      body?.commentaire,
      acteurDe(request),
    );
  }

  @Post(':id/rejeter')
  rejeter(
    @Param('id') id: string,
    @Body() body: { motif?: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.depensesService.rejeter(id, body?.motif, acteurDe(request));
  }

  @Post(':id/reprendre')
  reprendre(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.depensesService.reprendre(id, acteurDe(request));
  }

  @Post(':id/annuler')
  annuler(
    @Param('id') id: string,
    @Body() body: { motif?: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.depensesService.annuler(id, body?.motif, acteurDe(request));
  }

  @Post(':id/reception')
  @UseInterceptors(fichier())
  reception(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @UploadedFile() file: FichierRecu | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.depensesService.reception(id, body, file, acteurDe(request));
  }

  @Post(':id/facture')
  @UseInterceptors(fichier())
  facture(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @UploadedFile() file: FichierRecu | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.depensesService.facture(id, body, file, acteurDe(request));
  }

  @Post(':id/decaissements')
  @UseInterceptors(fichier())
  decaisser(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @UploadedFile() file: FichierRecu | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.depensesService.decaisser(id, body, file, acteurDe(request));
  }
}
