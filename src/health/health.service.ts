import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DATABASE_TIMEOUT_MS = 3000;

export type HealthReport = {
  status: 'ok' | 'error';
  database: 'up' | 'down';
  databaseLatencyMs: number | null;
  uptimeSeconds: number;
  timestamp: string;
};

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  // Le système est sain si le serveur répond et si la base exécute une requête
  // dans le délai imparti. Une base lente ou injoignable compte comme une panne.
  async check(): Promise<HealthReport> {
    const startedAt = Date.now();
    let timer: NodeJS.Timeout | undefined;
    let databaseUp = false;
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Délai de réponse de la base dépassé')),
            DATABASE_TIMEOUT_MS,
          );
        }),
      ]);
      databaseUp = true;
    } catch {
      databaseUp = false;
    } finally {
      clearTimeout(timer);
    }
    return {
      status: databaseUp ? 'ok' : 'error',
      database: databaseUp ? 'up' : 'down',
      databaseLatencyMs: databaseUp ? Date.now() - startedAt : null,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
