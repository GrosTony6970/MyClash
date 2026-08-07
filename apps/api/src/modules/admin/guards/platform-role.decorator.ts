import { SetMetadata } from '@nestjs/common';

export const PLATFORM_ROLE_KEY = 'platform:min-role';

/**
 * Raise the tier `PlatformRoleGuard` requires for a route.
 *
 * The guard already has a safe default per HTTP verb (see its docblock); this
 * decorator only ever moves a route off that default:
 *
 *   @PlatformRole('platform_admin')  — on a WRITE, opens it to platform admins.
 *                                      On a READ it is a NO-OP; reads are open
 *                                      to every tier and only 'super_admin'
 *                                      narrows them.
 *   @PlatformRole('super_admin')     — on a READ, reserves it. On a write it is
 *                                      redundant with the default, but worth
 *                                      writing where the reservation is the
 *                                      point rather than an accident.
 *
 * `platform_viewer` is deliberately not accepted: requiring the lowest tier is
 * what every route already does, so it could only ever mislead.
 */
export const PlatformRole = (min: 'platform_admin' | 'super_admin') =>
  SetMetadata(PLATFORM_ROLE_KEY, min);
