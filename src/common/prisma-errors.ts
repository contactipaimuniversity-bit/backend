function hasPrismaCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

export function isUniqueConstraintViolation(error: unknown): boolean {
  return hasPrismaCode(error, 'P2002');
}

export function isForeignKeyViolation(error: unknown): boolean {
  return hasPrismaCode(error, 'P2003');
}

export function isRecordNotFound(error: unknown): boolean {
  return hasPrismaCode(error, 'P2025');
}
