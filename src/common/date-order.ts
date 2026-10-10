import { BadRequestException } from '@nestjs/common';

export type DateOrder = 'asc' | 'desc';

export function parseDateOrder(value?: string): DateOrder {
  if (value === undefined || value.trim() === '' || value === 'desc') {
    return 'desc';
  }
  if (value === 'asc') return 'asc';
  throw new BadRequestException('ordreDate doit être asc ou desc');
}
