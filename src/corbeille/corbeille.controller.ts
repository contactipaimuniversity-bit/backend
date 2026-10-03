import { Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/guards/admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CorbeilleService } from './corbeille.service';

@Controller('corbeille')
@UseGuards(JwtAuthGuard, AdminGuard)
export class CorbeilleController {
  constructor(private readonly corbeilleService: CorbeilleService) {}

  @Get()
  findAll() {
    return this.corbeilleService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.corbeilleService.findOne(id);
  }

  @Post(':id/restaurer')
  restore(@Param('id') id: string) {
    return this.corbeilleService.restore(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.corbeilleService.remove(id);
  }
}