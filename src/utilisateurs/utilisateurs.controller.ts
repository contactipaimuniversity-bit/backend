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
import { TAILLE_MAX_FICHIER } from '../fichiers/cloudinary.service';
import type { FichierRecu } from '../fichiers/cloudinary.service';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { AdminGuard } from '../auth/guards/admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateUtilisateurDto } from './dto/create-utilisateur.dto';
import { UpdateProfilDto } from './dto/update-profil.dto';
import { MotifSuppressionDto } from '../corbeille/dto/motif-suppression.dto';
import { UtilisateursService } from './utilisateurs.service';

@Controller('utilisateurs')
@UseGuards(JwtAuthGuard)
export class UtilisateursController {
  constructor(private readonly utilisateursService: UtilisateursService) {}

  @Patch('me')
  updateProfile(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateProfilDto,
  ) {
    return this.utilisateursService.updateProfile(request.user.sub, dto);
  }

  // Chacun gère sa propre photo de profil ; elle se lit par le serveur, avec la session.
  @Post('me/photo')
  @UseInterceptors(
    FileInterceptor('photo', { limits: { fileSize: TAILLE_MAX_FICHIER } }),
  )
  definirPhoto(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() fichier: FichierRecu | undefined,
  ) {
    return this.utilisateursService.definirPhoto(request.user.sub, fichier);
  }

  @Delete('me/photo')
  retirerPhoto(@Req() request: AuthenticatedRequest) {
    return this.utilisateursService.retirerPhoto(request.user.sub);
  }

  @Get(':id/photo')
  @Header('Cache-Control', 'private, max-age=86400')
  async photo(@Param('id') id: string) {
    const { contenu, type } = await this.utilisateursService.lirePhoto(id);
    return new StreamableFile(contenu, { type });
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() createDto: CreateUtilisateurDto) {
    return this.utilisateursService.create(createDto);
  }

  @Get('postes')
  @UseGuards(AdminGuard)
  listPostes() {
    return this.utilisateursService.listPostes();
  }

  @Post('postes')
  @UseGuards(AdminGuard)
  createPoste(@Body() body: { nom: string; permissions: string[] }) {
    return this.utilisateursService.createPoste(body.nom, body.permissions);
  }

  @Patch('postes/:id')
  @UseGuards(AdminGuard)
  updatePoste(
    @Param('id') id: string,
    @Body() body: { nom: string; permissions: string[] },
  ) {
    return this.utilisateursService.updatePoste(id, body.nom, body.permissions);
  }

  @Get()
  @UseGuards(AdminGuard)
  findAll() {
    return this.utilisateursService.findAll();
  }

  @Patch(':id/acces')
  @UseGuards(AdminGuard)
  updateAccess(
    @Param('id') id: string,
    @Body() body: { posteId: string | null; permissions: string[] },
  ) {
    return this.utilisateursService.updateAccess(
      id,
      body.posteId,
      body.permissions,
    );
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(
    @Param('id') id: string,
    @Body() body: MotifSuppressionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.utilisateursService.remove(id, body.motif, request.user.sub);
  }
}
