import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { dateSaisieLocale } from '../common/saisie-locale';
import { TAILLE_MAX_FICHIER } from '../fichiers/cloudinary.service';
import type { FichierRecu } from '../fichiers/cloudinary.service';
import { MotifSuppressionDto } from '../corbeille/dto/motif-suppression.dto';
import { CreatePersonneDto } from './dto/create-personne.dto';
import { SearchPersonnesDto } from './dto/search-personnes.dto';
import { UpdatePersonneDto } from './dto/update-personne.dto';
import { PersonnesService } from './personnes.service';

@Controller('personnes')
@UseGuards(JwtAuthGuard)
export class PersonnesController {
  constructor(private readonly personnesService: PersonnesService) {}

  @Post()
  create(
    @Body() createDto: CreatePersonneDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.personnesService.create(
      createDto,
      request.user.sub,
      dateSaisieLocale(request),
    );
  }

  @Get()
  findAll(@Query() search: SearchPersonnesDto) {
    return this.personnesService.findAll(search);
  }

  // Fiches ressemblant à une personne qu'on s'apprête à créer (ou qu'on vient de créer).
  @Get('doublons')
  doublons(
    @Query('nom') nom?: string,
    @Query('prenom') prenom?: string,
    @Query('dateNaissance') dateNaissance?: string,
    @Query('telephone') telephone?: string,
    @Query('exclure') exclure?: string,
  ) {
    return this.personnesService.doublons({
      nom,
      prenom,
      dateNaissance,
      telephone,
      exclure,
    });
  }

  @Get(':id/historique')
  historique(@Param('id') id: string) {
    return this.personnesService.historique(id);
  }

  // La photo passe par le serveur : elle suit ainsi les droits d'accès au dossier.
  @Get(':id/photo')
  @Header('Cache-Control', 'private, max-age=86400')
  async photo(@Param('id') id: string) {
    const { contenu, type } = await this.personnesService.lirePhoto(id);
    return new StreamableFile(contenu, { type });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.personnesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDto: UpdatePersonneDto) {
    return this.personnesService.update(id, updateDto);
  }

  @Post(':id/photo')
  @UseInterceptors(
    FileInterceptor('photo', { limits: { fileSize: TAILLE_MAX_FICHIER } }),
  )
  definirPhoto(
    @Param('id') id: string,
    @UploadedFile() fichier: FichierRecu | undefined,
  ) {
    return this.personnesService.definirPhoto(id, fichier);
  }

  @Delete(':id/photo')
  retirerPhoto(@Param('id') id: string) {
    return this.personnesService.retirerPhoto(id);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Body() body: MotifSuppressionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.personnesService.remove(id, body.motif, request.user.sub);
  }
}
