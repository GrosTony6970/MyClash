import { createApiClient } from '@myclash/api-client';
import { getApiUrl } from './api-url';

/**
 * Shared @myclash/api-client instance — pilot adoption (code-review P8).
 * Cookie credentials + problem+json error surfacing come from the wrapper;
 * new web-scoring code should call `api.*` instead of hand-rolling fetch.
 */
export const api = createApiClient(getApiUrl());
