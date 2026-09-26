import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreatePersonneDto } from './dto/create-personne.dto';
import { SearchPersonnesDto } from './dto/search-personnes.dto';
import { UpdatePersonneDto } from './dto/update-personne.dto';
import { PersonnesService } from './personnes.service';

type AuthenticatedRequest = Request & {
  user: { sub: string };
};

@Controller('personnes')
@UseGuards(JwtAuthGuard)
export class PersonnesController {
  constructor(private readonly personnesService: PersonnesService) {}

  @Post()
  create(
    @Body() createDto: CreatePersonneDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.personnesService.create(createDto, request.user.sub);
  }

  @Get()
  findAll(@Query() search: SearchPersonnesDto) {
    return this.personnesService.findAll(search);
  }

  @Get(':id/historique')
  historique(@Param('id') id: string) {
    return this.personnesService.historique(id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.personnesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDto: UpdatePersonneDto) {
    return this.personnesService.update(id, updateDto);
  }
}
