import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Parses a body/query/param with a Zod schema from @jobsentinel/types.
 * ZodError is mapped to a 400 VALIDATION_ERROR envelope by HttpExceptionFilter.
 * Usage: `@Body(new ZodValidationPipe(PreferencesInput)) body: PreferencesInput`
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    return this.schema.parse(value);
  }
}
