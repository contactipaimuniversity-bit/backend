import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { AdminGuard } from '../auth/guards/admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ImpressionsService } from './impressions.service';
import type { ImpressionBody } from './impressions.service';

@Controller('impressions')
@UseGuards(JwtAuthGuard)
export class ImpressionsController {
  constructor(private readonly impressionsService: ImpressionsService) {}

  // Chaque utilisateur déclare ses propres impressions ; la lecture est réservée aux administrateurs.
  @Post()
  create(@Body() body: ImpressionBody, @Req() request: AuthenticatedRequest) {
    return this.impressionsService.create(body, request.user);
  }

  @Get()
  @UseGuards(AdminGuard)
  findAll(
    @Query()
    query: {
      q?: string;
      typeDocument?: string;
      utilisateurId?: string;
      dateDebut?: string;
      dateFin?: string;
      page?: string;
      limit?: string;
    },
  ) {
    return this.impressionsService.findAll(query);
  }
}
