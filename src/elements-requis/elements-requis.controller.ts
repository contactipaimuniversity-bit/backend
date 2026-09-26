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
import { AdminGuard } from '../auth/guards/admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateElementRequisDto } from './dto/create-element-requis.dto';
import { SearchElementsRequisDto } from './dto/search-elements-requis.dto';
import { UpdateElementRequisDto } from './dto/update-element-requis.dto';
import { ElementsRequisService } from './elements-requis.service';

@Controller('elements-requis')
@UseGuards(JwtAuthGuard)
export class ElementsRequisController {
  constructor(private readonly elementsRequisService: ElementsRequisService) {}

  @Get()
  findAll(@Query() search: SearchElementsRequisDto) {
    return this.elementsRequisService.findAll(search);
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() createDto: CreateElementRequisDto) {
    return this.elementsRequisService.create(createDto);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(@Param('id') id: string, @Body() updateDto: UpdateElementRequisDto) {
    return this.elementsRequisService.update(id, updateDto);
  }
}
