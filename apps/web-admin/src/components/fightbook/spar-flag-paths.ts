/** Where the safety reports are listed and marked: the club's own, or the platform's. */
export type FlagScope = { kind: 'club'; orgId: string } | { kind: 'platform' };

// Each path is written whole, in one literal: the route-contract test reads these.

export function flagsPagePath(scope: FlagScope, page: number): string {
  return scope.kind === 'club'
    ? `/api/v1/organizations/${scope.orgId}/fightbook/flags?page=${page}`
    : `/api/v1/admin/fightbook/flags?page=${page}`;
}

export function flagHandledPath(scope: FlagScope, flagId: string): string {
  return scope.kind === 'club'
    ? `/api/v1/organizations/${scope.orgId}/fightbook/flags/${flagId}/handled`
    : `/api/v1/admin/fightbook/flags/${flagId}/handled`;
}
