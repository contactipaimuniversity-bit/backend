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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { acteurDe } from '../common/acteur';
import { CartesService } from './cartes.service';

type Body = Record<string, unknown>;

@Controller('cartes')
@UseGuards(JwtAuthGuard)
export class CartesController {
  constructor(private readonly cartes: CartesService) {}

  @Post()
  generer(@Body() body: Body, @Req() request: AuthenticatedRequest) {
    return this.cartes.generer(body, acteurDe(request));
  }

  @Get('scan')
  scanner(@Query('code') code?: string) {
    return this.cartes.scanner(code);
  }

  @Get()
  liste(@Query('inscriptionId') inscriptionId?: string) {
    return this.cartes.liste(inscriptionId);
  }

  @Post(':id/desactivation')
  desactiver(@Param('id') id: string, @Body() body: Body) {
    return this.cartes.desactiver(id, body);
  }
}
