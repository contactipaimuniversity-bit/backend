import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { acteurDe } from '../common/acteur';
import { SynchronisationService } from './synchronisation.service';

// Ouvert à tout utilisateur connecté : la réponse ne contient que des
// identifiants, limités à ce que ses droits lui laissent consulter.
@Controller('synchronisation')
@UseGuards(JwtAuthGuard)
export class SynchronisationController {
  constructor(private readonly service: SynchronisationService) {}

  @Get('changements')
  changements(
    @Query('depuis') depuis: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.changements(depuis, acteurDe(request));
  }
}
