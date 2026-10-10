import {
  Controller,
  Get,
  Header,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HealthService } from './health.service';

// Point de contrôle pour un service de surveillance externe. Il est public
// (aucun jeton requis) et ne renvoie aucune donnée métier ni détail d'erreur.
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async check() {
    const report = await this.healthService.check();
    // 503 : le service de surveillance n'a qu'à lire le code de réponse.
    if (report.status !== 'ok') throw new ServiceUnavailableException(report);
    return report;
  }
}
