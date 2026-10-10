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
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { dateSaisieLocale } from '../common/saisie-locale';
import { CreateProspectDto } from './dto/create-prospect.dto';
import { CreateProspectRelanceDto } from './dto/create-prospect-relance.dto';
import { CreateThemeDto } from './dto/create-theme.dto';
import { SearchProspectsDto } from './dto/search-prospects.dto';
import { UpdateProspectDto } from './dto/update-prospect.dto';
import { ProspectsService } from './prospects.service';

@Controller('prospects')
@UseGuards(JwtAuthGuard)
export class ProspectsController {
  constructor(private readonly prospectsService: ProspectsService) {}

  @Post()
  create(
    @Body() createDto: CreateProspectDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.prospectsService.create(
      createDto,
      request.user.sub,
      dateSaisieLocale(request),
    );
  }

  @Get(':id/relances')
  findRelances(@Param('id') id: string) {
    return this.prospectsService.findRelances(id);
  }

  @Post(':id/relances')
  createRelance(
    @Param('id') id: string,
    @Body() createDto: CreateProspectRelanceDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.prospectsService.createRelance(
      id,
      createDto,
      request.user.sub,
      dateSaisieLocale(request),
    );
  }

  @Get('a-relancer')
  findToRelance() {
    return this.prospectsService.findToRelance();
  }

  @Get()
  findAll(@Query() search: SearchProspectsDto) {
    return this.prospectsService.findAll(search);
  }

  @Get(':id/themes')
  findThemes(@Param('id') id: string) {
    return this.prospectsService.findThemes(id);
  }

  @Post(':id/themes')
  addTheme(@Param('id') id: string, @Body() createDto: CreateThemeDto) {
    return this.prospectsService.addTheme(id, createDto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.prospectsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDto: UpdateProspectDto) {
    return this.prospectsService.update(id, updateDto);
  }
}
