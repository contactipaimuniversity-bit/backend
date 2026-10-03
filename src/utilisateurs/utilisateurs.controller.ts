import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
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
  @UseGuards(JwtAuthGuard)
  updateProfile(@Req() request: Request & { user: { sub: string } }, @Body() dto: UpdateProfilDto) {
    return this.utilisateursService.updateProfile(request.user.sub, dto);
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
    return this.utilisateursService.updateAccess(id, body.posteId, body.permissions);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(
    @Param('id') id: string,
    @Body() body: MotifSuppressionDto,
    @Req() request: Request & { user: { sub: string } },
  ) {
    return this.utilisateursService.remove(id, body.motif, request.user.sub);
  }
}
