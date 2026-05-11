export class TournamentQueryDto {
  question!: string;
}

export class TournamentQuerySettingsDto {
  accessPolicy?:
    | 'organizers_only'
    | 'organizers_head_judges'
    | 'organizers_head_judges_coaches'
    | 'anyone_with_tournament_access';
  rateLimitPerHour?: number;
}
