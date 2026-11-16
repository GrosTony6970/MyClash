import { describe, expect, it } from 'vitest';
import { PageReadFailed, readEveryRowById } from './read-every-row-by-id';

type Row = { id: string };
const ids = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: `r${String(from + i).padStart(4, '0')}` }));

/** Pages of `size` over `rows`, after the cursor; records each cursor asked. */
function pager(rows: Row[], size: number) {
  const asked: Array<string | undefined> = [];
  const page = async (after: string | undefined) => {
    asked.push(after);
    const past = after === undefined ? rows : rows.filter((r) => r.id > after);
    return { data: past.slice(0, size), error: null };
  };
  return { page, asked };
}

describe('readEveryRowById', () => {
  it('reads page after page from the last id, page 1 with no cursor, until a page is empty', async () => {
    const { page, asked } = pager(ids(25), 10);
    const { rows, stopped } = await readEveryRowById(page);
    expect(rows).toHaveLength(25);
    expect(stopped).toBe(false);
    expect(asked).toEqual([undefined, 'r0009', 'r0019', 'r0024']);
  });

  it('a page shorter than asked is not the end: only an empty page is', async () => {
    const { page, asked } = pager(ids(12), 5);
    await readEveryRowById(page);
    expect(asked).toHaveLength(4);
  });

  it('refuses a row without an id', async () => {
    const page = async () => ({ data: [{ name: 'x' }], error: null });
    await expect(readEveryRowById(page)).rejects.toThrow('a row without an id');
  });

  it('refuses an id it already returned: it would loop or read a row twice', async () => {
    const page = async () => ({ data: [{ id: 'a' }], error: null });
    await expect(readEveryRowById(page)).rejects.toThrow('got the row a twice');
  });

  it('a refused page is a PageReadFailed with PostgREST’s message', async () => {
    const page = async () => ({ data: null, error: { message: 'column does not exist' } });
    const read = readEveryRowById(page);
    await expect(read).rejects.toBeInstanceOf(PageReadFailed);
    await expect(read).rejects.toThrow('column does not exist');
  });

  it('stops before the next page once asked to, and says it stopped', async () => {
    const { page, asked } = pager(ids(25), 10);
    let stop = false;
    const read = readEveryRowById(
      async (after) => {
        const answer = await page(after);
        stop = true; // asked to stop while page 1 was read
        return answer;
      },
      { shouldStop: () => stop },
    );
    await expect(read).resolves.toEqual({ rows: ids(10), stopped: true });
    expect(asked).toEqual([undefined]);
  });
});
