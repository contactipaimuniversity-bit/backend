import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { AdminGuard } from '../auth/guards/admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuditService } from './audit.service';
import { CreateInteractionsDto } from './dto/create-interactions.dto';
import { CreateNavigationDto } from './dto/create-navigation.dto';
import { SearchAuditDto } from './dto/search-audit.dto';

@Controller('audit')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  // Chaque utilisateur déclare son propre temps passé ; la lecture est réservée aux administrateurs.
  @Post('navigation')
  recordNavigation(
    @Body() dto: CreateNavigationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.auditService.recordNavigation(dto, request.user);
  }

  @Post('interactions')
  recordInteractions(
    @Body() dto: CreateInteractionsDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.auditService.recordInteractions(dto, request.user);
  }

  @Get('flux')
  @UseGuards(AdminGuard)
  flux(@Query() search: SearchAuditDto) {
    return this.auditService.flux(search);
  }

  @Get('chronologie')
  @UseGuards(AdminGuard)
  chronologie(@Query() search: SearchAuditDto) {
    return this.auditService.chronologie(search);
  }

  @Get('utilisateurs/:id')
  @UseGuards(AdminGuard)
  profil(@Param('id') id: string, @Query() search: SearchAuditDto) {
    return this.auditService.profil(id, search);
  }

  @Get('synthese')
  @UseGuards(AdminGuard)
  synthese(@Query() search: SearchAuditDto) {
    return this.auditService.synthese(search);
  }

  @Get('actions')
  @UseGuards(AdminGuard)
  actions(@Query() search: SearchAuditDto) {
    return this.auditService.actions(search);
  }

  @Get('navigation')
  @UseGuards(AdminGuard)
  navigation(@Query() search: SearchAuditDto) {
    return this.auditService.navigation(search);
  }
}
