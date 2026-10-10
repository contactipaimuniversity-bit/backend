import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FinancesService } from './finances.service';

// Paramétrage financier : règles, catégories, fournisseurs, exercices, budgets.
@Controller('finances')
@UseGuards(JwtAuthGuard)
export class FinancesController {
  constructor(private readonly financesService: FinancesService) {}

  @Get('parametres')
  parametres() {
    return this.financesService.parametres();
  }

  @Patch('parametres')
  updateParametres(@Body() body: Record<string, unknown>) {
    return this.financesService.updateParametres(body);
  }

  @Get('categories')
  categories() {
    return this.financesService.categories();
  }

  @Post('categories')
  createCategorie(@Body() body: Record<string, unknown>) {
    return this.financesService.createCategorie(body);
  }

  @Patch('categories/:id')
  updateCategorie(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.financesService.updateCategorie(id, body);
  }

  @Get('fournisseurs')
  fournisseurs() {
    return this.financesService.fournisseurs();
  }

  @Post('fournisseurs')
  createFournisseur(@Body() body: Record<string, unknown>) {
    return this.financesService.createFournisseur(body);
  }

  @Patch('fournisseurs/:id')
  updateFournisseur(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.financesService.updateFournisseur(id, body);
  }

  @Get('exercices')
  exercices() {
    return this.financesService.exercices();
  }

  @Post('exercices')
  createExercice(@Body() body: Record<string, unknown>) {
    return this.financesService.createExercice(body);
  }

  @Patch('exercices/:id')
  updateExercice(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.financesService.updateExercice(id, body);
  }

  @Get('budget')
  budget(@Query('exerciceId') exerciceId?: string) {
    return this.financesService.budget(exerciceId);
  }

  @Put('budget')
  setBudget(@Body() body: Record<string, unknown>) {
    return this.financesService.setBudget(body);
  }
}
