// Components
export { Button } from './components/Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './components/Button';

export { Card, CardHeader, CardTitle, CardBody } from './components/Card';
export type { CardProps } from './components/Card';

export { Pill } from './components/Pill';
export type { PillProps, PillVariant } from './components/Pill';

export { GoogleIcon } from './components/GoogleIcon';
export type { GoogleIconProps } from './components/GoogleIcon';

export { NavIcon, NAV_ICON_NAMES, NAV_ICON_GLYPHS } from './components/NavIcon';
export type { NavIconProps, NavIconName } from './components/NavIcon';

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
export { computeFinalRanking, rankingBracketShape } from './components/bracket/final-ranking';
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

export { EventKindBadge } from './components/EventKindBadge';
export type { EventKindBadgeProps } from './components/EventKindBadge';

export { MatchScoreboard } from './components/MatchScoreboard';
export type { MatchScoreboardProps } from './components/MatchScoreboard';

export { TVScoreboard } from './components/TVScoreboard';
export type { TVScoreboardProps } from './components/TVScoreboard';

export { MatchTimeline } from './components/MatchTimeline';
export type { MatchTimelineProps, MatchTimelineScale } from './components/MatchTimeline';

export { BoutFlowChart } from './components/BoutFlowChart';
export type { BoutFlowChartProps, BoutFlowScale } from './components/BoutFlowChart';

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

export { CollapsibleSection } from './components/CollapsibleSection';

export { FormField } from './components/FormField';
export type { FormFieldProps } from './components/FormField';
export { PasswordChecklist } from './components/PasswordChecklist';
export type { PasswordChecklistProps } from './components/PasswordChecklist';

export { HelpTooltip } from './components/HelpTooltip';
export type { HelpTooltipProps } from './components/HelpTooltip';

export { StatusHelp } from './components/StatusHelp';
export type { StatusHelpProps } from './components/StatusHelp';
export { hasStatusHelp, statusHelpKeys, statusesWithHelp } from './utils/status-help';
export type { StatusHelpDomain, StatusHelpKeys } from './utils/status-help';

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
  asColorToken,
  tintBgClassFor,
  tintBorderClassFor,
  tintTextClassFor,
} from './utils/color-token';
export type { ColorToken } from './utils/color-token';

export {
  sideStyle,
  styleForToken,
  legibleOn,
  outlineInkOn,
  sideColorsFor,
  sideColorsForTokens,
} from './utils/side-color';
export type { SideColorToken, SideColorStyle } from './utils/side-color';

export { formatMatchClock } from './utils/format-match-clock';

// ── Unified match timeline (exchanges + cards, one contiguous numbering) ──
// Shared by the scoring pad, the corrections drawer, the TV display and the
// public match page so their `#N` always agree.

export {
  buildUnifiedTimeline,
  ascendingWithNumbers,
  orderedWithNumbers,
  exchangeOptionLabel,
  NO_EXCHANGE_REASONS,
  NO_EXCHANGE_REASON_KEYS,
} from './utils/exchange-timeline';
export type {
  UnifiedEvent,
  BuildTimelineArgs,
  NoExchangeReasonId,
} from './utils/exchange-timeline';

export type { ClockEvent } from './types/match-events';

export { buildBoutFlow } from './utils/bout-flow';
export type {
  BoutFlowSeries,
  BoutFlowPoint,
  BoutFlowPause,
  BoutFlowClockEvent,
  BuildBoutFlowArgs,
} from './utils/bout-flow';

export { exchangeDeltaLabel, afterblowDefenderLabel } from './utils/exchange-delta-label';
export { roundLabel, roundColumnLabel, type RoundTranslator } from './utils/round-label';

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
export { statusPillClass } from './utils/status-pill';
export type {
  StatusSemantic,
  StatusSurface,
  StatusPillTone,
  StatusPillSize,
  StatusPillShape,
} from './utils/status-pill';

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

export { LegalFooter } from './components/LegalFooter';
export type { LegalFooterProps, LegalFooterLink } from './components/LegalFooter';

// ── Runtime feature-flags consumed by every app (banner + realtime) ──────

export { MaintenanceBanner } from './components/MaintenanceBanner';
export { useRuntimeFlags, getRuntimeFlagsCached } from './hooks/useRuntimeFlags';
export {
  deriveFreshness,
  fallbackPollMs,
  isFreshnessAlarming,
  shouldStartFallbackPoll,
  IDLE_POLL_MS,
  LIVE_POLL_MS,
} from './hooks/realtime-freshness';
export type {
  FallbackPollInput,
  Freshness,
  FreshnessInput,
  FreshnessKind,
} from './hooks/realtime-freshness';
export { FreshnessChip } from './components/FreshnessChip';
export type { FreshnessChipProps } from './components/FreshnessChip';
export { useNow, useClock, useClientClock, useSecondsClock, useNowSeconds } from './hooks/useNow';
export type { ClockState } from './hooks/useNow';
export { timeSimulationOffsetMs, isTimeSimulationActive } from './hooks/time-simulation';
