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
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { dateSaisieLocale } from '../common/saisie-locale';
import { CandidaturesPersonnelService } from './candidatures-personnel.service';
import { CreateCandidaturePersonnelDto } from './dto/create-candidature-personnel.dto';
import { SearchCandidaturesPersonnelDto } from './dto/search-candidatures-personnel.dto';
import { UpdateCandidaturePersonnelDto } from './dto/update-candidature-personnel.dto';
import { UpdateElementPersonnelDto } from './dto/update-element-personnel.dto';

@Controller('candidatures-personnel')
@UseGuards(JwtAuthGuard)
export class CandidaturesPersonnelController {
  constructor(private readonly service: CandidaturesPersonnelService) {}

  @Post()
  create(@Body() dto: CreateCandidaturePersonnelDto, @Req() request: Request) {
    return this.service.create(dto, dateSaisieLocale(request));
  }

  @Get()
  findAll(@Query() search: SearchCandidaturesPersonnelDto) {
    return this.service.findAll(search);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCandidaturePersonnelDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/elements/:elementId')
  updateElement(
    @Param('id') id: string,
    @Param('elementId') elementId: string,
    @Body() dto: UpdateElementPersonnelDto,
  ) {
    return this.service.updateElement(id, elementId, dto);
  }
}
