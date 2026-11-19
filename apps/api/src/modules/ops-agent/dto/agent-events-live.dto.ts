/** Why an Event reads as live (ruling 882): its status, a bout in play, today within its dates. */
export type AgentLiveSign = 'status' | 'bout' | 'dates';

/** `GET /ops-agent/events/live`: the Events that hold the ops agent's repairs back. */
export interface AgentEventsLiveDto {
  generatedAt: string;
  live: boolean;
  events: Array<{ id: string; name: string; status: string; signs: AgentLiveSign[] }>;
}
