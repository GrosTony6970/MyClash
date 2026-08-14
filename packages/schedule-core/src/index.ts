/**
 * @myclash/schedule-core — pure schedule-grid geometry + block model shared by
 * the organizer admin schedule board and the public event schedule timeline.
 * No React, no I/O. Time math resolves wall-clock in the EVENT timezone via
 * @myclash/time, so a grid reads identically for any viewer.
 */
export * from './schedule-grid-geometry';
export * from './schedule-blocks';
export * from './bracket-round-group';
export * from './compute-grid-end';
export * from './compute-grid-start';
export * from './event-days';
export * from './workshop-board-geometry';
