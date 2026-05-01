/**
 * exports.controller.ts — T-1004
 *
 * GET /api/v1/events/:eventId/exports/fighters.csv       — HEMA Ratings fighters
 * GET /api/v1/events/:eventId/exports/full.csv           — all matches + exchanges
 * GET /api/v1/events/:eventId/exports/full.json          — full event JSON
 * GET /api/v1/tournaments/:tournamentId/exports/results.csv — HEMA Ratings results
 */

import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import { ExportsService } from './exports.service';

@ApiTags('exports')
@Controller()
export class ExportsController {
  constructor(
    private readonly exports: ExportsService,
    private readonly supabase: SupabaseService,
  ) {}

  // ── HEMA Ratings: fighters.csv ────────────────────────────────────────────

  @Get('events/:eventId/exports/fighters.csv')
  @ApiOperation({ summary: 'HEMA Ratings fighters.csv export' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async fightersCsv(@Param('eventId', ParseUUIDPipe) eventId: string, @Res() reply: FastifyReply) {
    const csv = await this.exports.generateFightersCsv(eventId);
    void reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="fighters.csv"')
      .send(csv);
  }

  // ── HEMA Ratings: tournament results CSV ──────────────────────────────────

  @Get('tournaments/:tournamentId/exports/results.csv')
  @ApiOperation({ summary: 'HEMA Ratings tournament results CSV export' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  async resultsCsv(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Res() reply: FastifyReply,
  ) {
    // Get tournament slug for filename
    const { data: tournament } = await this.supabase.service
      .from('tournaments')
      .select('slug')
      .eq('id', tournamentId)
      .maybeSingle();

    const slug = (tournament as { slug: string } | null)?.slug ?? tournamentId;
    const { filename, content } = await this.exports.generateTournamentResultsCsv(
      tournamentId,
      slug,
    );

    void reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(content);
  }

  // ── Full CSV export ───────────────────────────────────────────────────────

  @Get('events/:eventId/exports/full.csv')
  @ApiOperation({ summary: 'Full event CSV export (all matches + exchanges)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async fullCsv(@Param('eventId', ParseUUIDPipe) eventId: string, @Res() reply: FastifyReply) {
    const csv = await this.exports.generateFullCsv(eventId);
    void reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="exchanges.csv"')
      .send(csv);
  }

  // ── Full JSON export ──────────────────────────────────────────────────────

  @Get('events/:eventId/exports/full.json')
  @ApiOperation({ summary: 'Full event JSON export (round-trippable)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async fullJson(@Param('eventId', ParseUUIDPipe) eventId: string, @Res() reply: FastifyReply) {
    const data = await this.exports.generateEventJson(eventId);
    void reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="event.json"')
      .send(JSON.stringify(data, null, 2));
  }
}
