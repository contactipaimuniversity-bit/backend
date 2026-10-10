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
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MotifSuppressionDto } from '../corbeille/dto/motif-suppression.dto';
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
  create(@Body() createDto: CreateElementRequisDto) {
    return this.elementsRequisService.create(createDto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDto: UpdateElementRequisDto) {
    return this.elementsRequisService.update(id, updateDto);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Body() body: MotifSuppressionDto | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.elementsRequisService.remove(id, body?.motif, request.user.sub);
  }
}
