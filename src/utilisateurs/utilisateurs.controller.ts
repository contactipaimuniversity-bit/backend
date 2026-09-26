import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/guards/admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateUtilisateurDto } from './dto/create-utilisateur.dto';
import { UtilisateursService } from './utilisateurs.service';

@Controller('utilisateurs')
@UseGuards(JwtAuthGuard, AdminGuard)
export class UtilisateursController {
  constructor(private readonly utilisateursService: UtilisateursService) {}

  @Post()
  create(@Body() createDto: CreateUtilisateurDto) {
    return this.utilisateursService.create(createDto);
  }

  @Get()
  findAll() {
    return this.utilisateursService.findAll();
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.utilisateursService.remove(id);
  }
}
