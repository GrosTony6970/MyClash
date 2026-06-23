import { Injectable, ValidationPipe } from '@nestjs/common';
import type { ArgumentMetadata, ValidationPipeOptions } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';

/**
 * Global validation pipe that routes by DTO type during the incremental
 * class-validator → Zod migration (adopted standard #1):
 *
 *  - Parameters typed with a `nestjs-zod` DTO (`createZodDto(...)`, which sets a
 *    static `isZodDto`) are validated by Zod. `.strict()` schemas reject unknown
 *    fields, preserving the `forbidNonWhitelisted` behaviour.
 *  - Everything else is delegated to the standard class-validator `ValidationPipe`
 *    with the same options.
 *
 * Why a dispatcher: a single class-validator pipe with `whitelist: true` would
 * strip every property of a ZodDto (it has no class-validator metadata), while
 * replacing the global pipe outright would silently disable validation for all
 * remaining class-validator DTOs. Routing by metatype lets both coexist.
 */
@Injectable()
export class ZodOrClassValidationPipe extends ValidationPipe {
  private readonly zodPipe = new ZodValidationPipe();

  constructor(options?: ValidationPipeOptions) {
    super(options);
  }

  override transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    const metatype = metadata.metatype as { isZodDto?: boolean } | undefined;
    if (metatype?.isZodDto === true) {
      // Defer into `.then` so a synchronous Zod validation throw surfaces as a
      // rejected promise (consistent with the class-validator branch).
      return Promise.resolve().then(() => this.zodPipe.transform(value, metadata));
    }
    return super.transform(value, metadata);
  }
}
