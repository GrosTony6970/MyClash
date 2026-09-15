import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PROGRAMME_CONFIG_DEFAULTS } from './dto/programme.dto';
import { readProgrammeSheet } from './programme-sheet';

function client(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  const from = vi.fn().mockReturnValue(chain);
  return { db: { from } as never, from, chain };
}

describe('readProgrammeSheet', () => {
  it("reads one Event's row and only its config_json", async () => {
    const { db, from, chain } = client({ data: null, error: null });

    const sheet = await readProgrammeSheet(db, 'event-1');

    expect(sheet).toEqual(PROGRAMME_CONFIG_DEFAULTS);
    expect(from).toHaveBeenCalledWith('event_programme_configs');
    // The double answers whatever the projection asks for, so the read is only
    // proved by the string it sends.
    expect(chain.select).toHaveBeenCalledWith('config_json');
    expect(chain.eq).toHaveBeenCalledWith('event_id', 'event-1');
  });

  it('surfaces a failed read instead of planning on the defaults', async () => {
    const { db } = client({ data: null, error: { message: 'timeout' } });

    await expect(readProgrammeSheet(db, 'event-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
