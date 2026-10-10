import { PrismaService } from '../prisma/prisma.service';
import { HealthService } from './health.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('HealthService.check', () => {
  it('reports ok when the database answers', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    } as unknown as PrismaService;

    const report = await new HealthService(prisma).check();

    expect(report.status).toBe('ok');
    expect(report.database).toBe('up');
    expect(typeof report.databaseLatencyMs).toBe('number');
  });

  it('reports an error without leaking details when the database is unreachable', async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:5432')),
    } as unknown as PrismaService;

    const report = await new HealthService(prisma).check();

    expect(report).toMatchObject({
      status: 'error',
      database: 'down',
      databaseLatencyMs: null,
    });
    expect(JSON.stringify(report)).not.toContain('ECONNREFUSED');
  });

  it('treats a database that does not answer in time as down', async () => {
    jest.useFakeTimers();
    const prisma = {
      $queryRaw: jest.fn().mockReturnValue(new Promise(() => undefined)),
    } as unknown as PrismaService;

    const pending = new HealthService(prisma).check();
    await jest.advanceTimersByTimeAsync(3000);

    await expect(pending).resolves.toMatchObject({ database: 'down' });
    jest.useRealTimers();
  });
});
