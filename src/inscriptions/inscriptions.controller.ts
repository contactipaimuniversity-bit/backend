import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateInscriptionDto } from './dto/create-inscription.dto';
import { SearchInscriptionsDto } from './dto/search-inscriptions.dto';
import { UpdateInscriptionElementDto } from './dto/update-inscription-element.dto';
import { UpdateInscriptionDto } from './dto/update-inscription.dto';
import { InscriptionsService } from './inscriptions.service';

@Controller('inscriptions')
@UseGuards(JwtAuthGuard)
export class InscriptionsController {
  constructor(private readonly inscriptionsService: InscriptionsService) {}

  @Post()
  create(@Body() createDto: CreateInscriptionDto) {
    return this.inscriptionsService.create(createDto);
  }

  @Get()
  findAll(@Query() search: SearchInscriptionsDto) {
    return this.inscriptionsService.findAll(search);
  }

  @Get(':id/elements')
  findElements(@Param('id') id: string) {
    return this.inscriptionsService.findElements(id);
  }

  @Patch(':id/elements/:elementRequisId')
  updateElement(
    @Param('id') id: string,
    @Param('elementRequisId') elementRequisId: string,
    @Body() updateDto: UpdateInscriptionElementDto,
  ) {
    return this.inscriptionsService.updateElement(
      id,
      elementRequisId,
      updateDto,
    );
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDto: UpdateInscriptionDto) {
    return this.inscriptionsService.update(id, updateDto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.inscriptionsService.findOne(id);
  }
}
