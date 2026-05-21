// Components
export { Button } from './components/Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './components/Button';

export { Card, CardHeader, CardTitle, CardBody } from './components/Card';
export type { CardProps } from './components/Card';

export { Pill } from './components/Pill';
export type { PillProps, PillVariant } from './components/Pill';

export { ShieldBg, ShieldIcon } from './components/ShieldBg';
export type { ShieldBgProps } from './components/ShieldBg';

export { ScoreDisplay } from './components/ScoreDisplay';
export type { ScoreDisplayProps } from './components/ScoreDisplay';

export { Badge } from './components/Badge';
export type { BadgeProps, BadgeVariant } from './components/Badge';

export { Input } from './components/Input';
export type { InputProps } from './components/Input';

export { Spinner } from './components/Spinner';
export type { SpinnerProps } from './components/Spinner';

export { Divider } from './components/Divider';
export type { DividerProps } from './components/Divider';

export { Avatar } from './components/Avatar';
export type { AvatarProps } from './components/Avatar';

export { EmptyState } from './components/EmptyState';
export type { EmptyStateProps } from './components/EmptyState';

export { PageHeader } from './components/PageHeader';
export type { PageHeaderProps } from './components/PageHeader';

export { BracketView } from './components/BracketView';
export type {
  BracketViewProps,
  BracketSlotData,
  BracketConfig,
  PodiumData,
} from './components/BracketView';

export { TournamentColorDot } from './components/TournamentColorDot';
export type { TournamentColorDotProps } from './components/TournamentColorDot';

export { SkillBadge } from './components/SkillBadge';
export type { SkillBadgeProps } from './components/SkillBadge';

// ── Tournament Manual admin components (Phase 1 of the frontend overhaul) ──

export { FoilMark } from './components/FoilMark';
export type { FoilMarkProps } from './components/FoilMark';

export { AdminPageHeader } from './components/AdminPageHeader';
export type { AdminPageHeaderProps } from './components/AdminPageHeader';

export { DataTable, DataTableHead, DataTableRow, DataTableCell } from './components/DataTable';
export type { DataTableProps, DataTableRowProps, DataTableCellProps } from './components/DataTable';

export { StatusBadge } from './components/StatusBadge';
export type { StatusBadgeProps, StatusBadgeVariant } from './components/StatusBadge';

export { FormField } from './components/FormField';
export type { FormFieldProps } from './components/FormField';

export { HelpTooltip } from './components/HelpTooltip';
export type { HelpTooltipProps } from './components/HelpTooltip';

// ── Phase 2: dialogs + toasts + focus trap ────────────────────────────────

export { ConfirmDialog } from './components/ConfirmDialog';
export type { ConfirmDialogProps } from './components/ConfirmDialog';

export { PromptDialog } from './components/PromptDialog';
export type { PromptDialogProps } from './components/PromptDialog';

export { ToastProvider, useToast } from './components/Toast';
export type { ToastVariant } from './components/Toast';

export { useFocusTrap } from './hooks/useFocusTrap';

// ── Phase 4: bulk actions ─────────────────────────────────────────────────

export { useSelection } from './hooks/useSelection';
export type { UseSelectionResult } from './hooks/useSelection';

export { BulkActionBar } from './components/BulkActionBar';
export type { BulkActionBarProps } from './components/BulkActionBar';

export { RowActionButton, rowActionClasses } from './components/RowActionButton';
export type { RowActionButtonProps, RowActionVariant } from './components/RowActionButton';

// ── Sortable headers + live fuzzy search (Phase 5 — admin list pages) ─────

export { SortableHeader, sortRows, nextSortState } from './components/SortableHeader';
export type { SortableHeaderProps } from './components/SortableHeader';

export { useSortableList } from './hooks/useSortableList';

export { fuzzyMatch, normalizeForSearch } from './utils/fuzzy-match';

export { accentClassFor, tintBgClassFor, tintTextClassFor } from './utils/color-token';
export type { ColorToken } from './utils/color-token';
