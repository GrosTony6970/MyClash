import { describe, it, expect, beforeAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = module.get(HealthController);
  });

  it('returns status "ok"', () => {
    const result = controller.getHealth();
    expect(result.status).toBe('ok');
  });

  it('returns a non-negative uptime number', () => {
    const result = controller.getHealth();
    expect(typeof result.uptime).toBe('number');
    expect(result.uptime).toBeGreaterThanOrEqual(0);
  });
});
