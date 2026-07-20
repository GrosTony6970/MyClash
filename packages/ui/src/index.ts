// Components
export { Button } from './components/Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './components/Button';

export { Card, CardHeader, CardTitle, CardBody } from './components/Card';
export type { CardProps } from './components/Card';

export { Pill } from './components/Pill';
export type { PillProps, PillVariant } from './components/Pill';

export { GoogleIcon } from './components/GoogleIcon';
export type { GoogleIconProps } from './components/GoogleIcon';

export { Badge } from './components/Badge';
export type { BadgeProps, BadgeVariant } from './components/Badge';

export { Input } from './components/Input';
export type { InputProps } from './components/Input';

export { Spinner } from './components/Spinner';
export type { SpinnerProps } from './components/Spinner';

export { Switch } from './components/Switch';
export type { SwitchProps } from './components/Switch';

export { Divider } from './components/Divider';
export type { DividerProps } from './components/Divider';

export { Avatar } from './components/Avatar';
export type { AvatarProps } from './components/Avatar';

export { RatingHistoryChart } from './components/RatingHistoryChart';
export type { RatingHistoryChartProps, RatingHistoryPoint } from './components/RatingHistoryChart';

export { EmptyState } from './components/EmptyState';
export type { EmptyStateProps } from './components/EmptyState';

export { BracketView } from './components/BracketView';
export type {
  BracketViewProps,
  BracketSlotData,
  BracketConfig,
  PodiumData,
} from './components/BracketView';
export { MedalPodium } from './components/bracket/MedalPodium';
export type { MedalPodiumProps } from './components/bracket/MedalPodium';
export { extractBronzeMatch } from './components/bracket/extract-bronze-match';
export { computeFinalRanking } from './components/bracket/final-ranking';
export type {
  RankingSlot,
  PoolEntry,
  FinalRankingEntry,
  FinalRankingResultKind,
} from './components/bracket/final-ranking';

export { TournamentColorDot } from './components/TournamentColorDot';
export type { TournamentColorDotProps } from './components/TournamentColorDot';

export { SkillBadge } from './components/SkillBadge';
export type { SkillBadgeProps } from './components/SkillBadge';

export { MatchScoreboard } from './components/MatchScoreboard';
export type { MatchScoreboardProps } from './components/MatchScoreboard';

export { TVScoreboard } from './components/TVScoreboard';
export type { TVScoreboardProps } from './components/TVScoreboard';

export { MatchTimeline } from './components/MatchTimeline';
export type { MatchTimelineProps, MatchTimelineScale } from './components/MatchTimeline';

export { LiceWaitingDisplay } from './components/LiceWaitingDisplay';
export type {
  LiceWaitingDisplayProps,
  LiceWaitingDisplayNextMatch,
} from './components/LiceWaitingDisplay';

// ── Tournament Manual admin components (Phase 1 of the frontend overhaul) ──

export { FoilMark } from './components/FoilMark';
export type { FoilMarkProps } from './components/FoilMark';

export { AdminPageHeader } from './components/AdminPageHeader';
export type { AdminPageHeaderProps } from './components/AdminPageHeader';

export { MetricCard } from './components/MetricCard';
export type { MetricCardProps } from './components/MetricCard';

export { StatsGrid } from './components/StatsGrid';
export type { StatsGridProps } from './components/StatsGrid';

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
export { Modal } from './components/Modal';
export type { ModalProps, ModalSize } from './components/Modal';

export { useConfirm } from './components/useConfirm';
export type { ConfirmOptions } from './components/useConfirm';

export { PromptDialog, usePrompt } from './components/PromptDialog';
export type { PromptDialogProps, PromptOptions } from './components/PromptDialog';

export { AiKeysManager } from './components/AiKeysManager';
export type { AiKeysManagerProps } from './components/AiKeysManager';
export { AiKeyFormDialog } from './components/AiKeyFormDialog';
export type {
  AiKeyFormDialogProps,
  AiKeyFormValues,
  AiKeyFormInitial,
  AiKeyModelOption,
  AiKeyProvider,
} from './components/AiKeyFormDialog';

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

export { CountryCombobox } from './components/CountryCombobox';
export type { CountryComboboxProps } from './components/CountryCombobox';

export { ClubCombobox } from './components/ClubCombobox';
export type { ClubComboboxProps, ClubOption, ClubValue } from './components/ClubCombobox';

export { SegmentedTabs } from './components/SegmentedTabs';
export type { SegmentedTabsProps, SegmentedTab } from './components/SegmentedTabs';

export { Skeleton } from './components/Skeleton';
export type { SkeletonProps } from './components/Skeleton';

export { getCountryOptions, formatCountryName, PINNED_COUNTRIES } from './lib/countries';
export type { CountryOption } from './lib/countries';

export {
  accentClassFor,
  tintBgClassFor,
  tintBorderClassFor,
  tintTextClassFor,
} from './utils/color-token';
export type { ColorToken } from './utils/color-token';

export { sideStyle, styleForToken } from './utils/side-color';
export type { SideColorToken, SideColorStyle } from './utils/side-color';

export { formatMatchClock } from './utils/format-match-clock';

// ── Unified match timeline (exchanges + cards, one contiguous numbering) ──
// Shared by the scoring pad, the corrections drawer, the TV display and the
// public match page so their `#N` always agree.

export {
  buildUnifiedTimeline,
  orderedWithNumbers,
  exchangeOptionLabel,
} from './utils/exchange-timeline';
export type { UnifiedEvent, BuildTimelineArgs } from './utils/exchange-timeline';

export { exchangeDeltaLabel, afterblowDefenderLabel } from './utils/exchange-delta-label';

export type { ExchangeRow, ExchangeType, PenaltyCard } from './types/match-events';

export {
  statusPillTone,
  tournamentStatusSemantic,
  matchStatusSemantic,
  workshopStatusSemantic,
  reviewStatusSemantic,
  phaseVisibilitySemantic,
  clockStatusSemantic,
  rulesetSemantic,
} from './utils/status-pill';
export type { StatusSemantic, StatusSurface, StatusPillTone } from './utils/status-pill';

export { useNextMatch } from './hooks/useNextMatch';
export type { NextMatchInfo } from './hooks/useNextMatch';
export { useAdjacentMatches } from './hooks/useAdjacentMatches';

export { useLiveMatch } from './hooks/useLiveMatch';
export type {
  DisplayMatch,
  MatchStatus,
  Penalty,
  ClockSnapshot,
  UseLiveMatchResult,
} from './hooks/useLiveMatch';

// ── Runtime feature-flags consumed by every app (banner + realtime) ──────

export { MaintenanceBanner } from './components/MaintenanceBanner';
export { useRuntimeFlags, getRuntimeFlagsCached } from './hooks/useRuntimeFlags';
export { useNow } from './hooks/useNow';
export { timeSimulationOffsetMs } from './hooks/time-simulation';
