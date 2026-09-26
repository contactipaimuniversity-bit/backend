import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../auth/guards/admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateEcheanceDto } from './dto/create-echeance.dto';
import { CreateTypeBourseDto } from './dto/create-type-bourse.dto';
import { UpdateTypeBourseDto } from './dto/update-type-bourse.dto';
import { TypesBourseService } from './types-bourse.service';

@Controller('types-bourse')
@UseGuards(JwtAuthGuard)
export class TypesBourseController {
  constructor(private readonly typesBourseService: TypesBourseService) {}

  @Get()
  findAll() {
    return this.typesBourseService.findAll();
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() createDto: CreateTypeBourseDto) {
    return this.typesBourseService.create(createDto);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(@Param('id') id: string, @Body() updateDto: UpdateTypeBourseDto) {
    return this.typesBourseService.update(id, updateDto);
  }

  @Get(':id/echeances')
  findEcheances(@Param('id') id: string) {
    return this.typesBourseService.findEcheances(id);
  }

  @Post(':id/echeances')
  @UseGuards(AdminGuard)
  addEcheance(
    @Param('id') id: string,
    @Body() createDto: CreateEcheanceDto,
  ) {
    return this.typesBourseService.addEcheance(id, createDto);
  }
}
