import type { MessageTree } from '../../message-tree.js';

export const actions = {
  add: 'Add',
  apply: 'Apply',
  back: 'Back',
  cancel: 'Cancel',
  clear: 'Clear',
  close: 'Close',
  delete: 'Delete',
  dismiss: 'Dismiss',
  edit: 'Edit',
  next: 'Next',
  reject: 'Reject',
  remove: 'Remove',
  retry: 'Retry',
  refresh: 'Refresh',
  save: 'Save',
  search: 'Search',
  view: 'View',
} as const satisfies MessageTree;
