import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AdminGuard } from '../auth/guards/admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateUtilisateurDto } from './dto/create-utilisateur.dto';
import { UpdateProfilDto } from './dto/update-profil.dto';
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

  @Get()
  @UseGuards(AdminGuard)
  findAll() {
    return this.utilisateursService.findAll();
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id') id: string) {
    return this.utilisateursService.remove(id);
  }
}
