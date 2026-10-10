import { parseDateOrder } from './date-order';

describe('parseDateOrder', () => {
  it('defaults to newest first', () => {
    expect(parseDateOrder()).toBe('desc');
    expect(parseDateOrder('')).toBe('desc');
  });

  it('accepts oldest first', () => {
    expect(parseDateOrder('asc')).toBe('asc');
  });

  it('rejects unsupported order values', () => {
    expect(() => parseDateOrder('newest')).toThrow(
      'ordreDate doit être asc ou desc',
    );
  });
});
