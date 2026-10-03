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
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MotifSuppressionDto } from '../corbeille/dto/motif-suppression.dto';
import { CreateDemandeBourseDto } from './dto/create-demande-bourse.dto';
import { SearchDemandesBourseDto } from './dto/search-demandes-bourse.dto';
import { UpdateDecisionDto } from './dto/update-decision.dto';
import { UpdateElementDossierDto } from './dto/update-element-dossier.dto';
import { UpdateEntretienDto } from './dto/update-entretien.dto';
import { DemandesBourseService } from './demandes-bourse.service';

type AuthenticatedRequest = Request & { user: { sub: string } };

@Controller('demandes-bourse')
@UseGuards(JwtAuthGuard)
export class DemandesBourseController {
  constructor(private readonly demandesBourseService: DemandesBourseService) {}

  @Post()
  create(
    @Body() createDto: CreateDemandeBourseDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.demandesBourseService.create(createDto, request.user.sub);
  }

  @Get()
  findAll(@Query() search: SearchDemandesBourseDto) {
    return this.demandesBourseService.findAll(search);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Body() body: MotifSuppressionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.demandesBourseService.remove(id, body.motif, request.user.sub);
  }

  @Get(':id/elements')
  findElements(@Param('id') id: string) {
    return this.demandesBourseService.findElements(id);
  }

  @Get(':id/finance')
  findFinance(@Param('id') id: string) {
    return this.demandesBourseService.findFinance(id);
  }

  @Patch(':id/elements/:elementRequisId')
  updateElement(
    @Param('id') id: string,
    @Param('elementRequisId') elementRequisId: string,
    @Body() updateDto: UpdateElementDossierDto,
  ) {
    return this.demandesBourseService.updateElement(
      id,
      elementRequisId,
      updateDto,
    );
  }

  @Patch(':id/decision')
  updateDecision(
    @Param('id') id: string,
    @Body() updateDto: UpdateDecisionDto,
  ) {
    return this.demandesBourseService.updateDecision(id, updateDto);
  }

  @Patch(':id')
  updateEntretien(
    @Param('id') id: string,
    @Body() updateDto: UpdateEntretienDto,
  ) {
    return this.demandesBourseService.updateEntretien(id, updateDto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.demandesBourseService.findOne(id);
  }
}
