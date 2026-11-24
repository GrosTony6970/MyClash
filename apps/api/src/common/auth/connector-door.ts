import { SetMetadata, type CustomDecorator } from '@nestjs/common';

export const CONNECTOR_DOOR_KEY = 'auth:connector-door';

/**
 * Marks a route handler (or controller) as the one place a Claude connector
 * token may be used. A connector token is a normal login plus a `client_id`
 * claim; AuthGuard refuses it on every route that lacks this mark.
 */
export const ConnectorDoor = (): CustomDecorator => SetMetadata(CONNECTOR_DOOR_KEY, true);
