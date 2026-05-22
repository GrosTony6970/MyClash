import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { IsIn, IsUUID } from 'class-validator';
import {
  AssignmentBoardService,
  REFEREE_ASSIGNMENT_ROLES,
  type ManualAssignmentDto,
} from './assignment-board.service';

class ManualAssignmentRequestDto {
  @IsUUID()
  poolId!: string;

  @IsIn(REFEREE_ASSIGNMENT_ROLES)
  role!: ManualAssignmentDto['role'];

  @IsUUID()
  userId!: string;
}

class LegacyManualAssignmentRequestDto extends ManualAssignmentRequestDto {
  @IsUUID()
  eventId!: string;
}

@ApiTags('referees')
@Controller()
export class AssignmentBoardController {
  constructor(private readonly assignments: AssignmentBoardService) {}

  @Get('events/:eventId/referee-assignment-board')
  @ApiOperation({ summary: 'Read the referee assignment board for generated pools' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async getBoard(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.assignments.getBoard(eventId);
  }

  @Post('events/:eventId/referee-assignment-preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Preview referee auto-assignment without persisting' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async preview(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.assignments.preview(eventId);
  }

  @Post('events/:eventId/referee-assignment-preview/apply')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apply the current referee auto-assignment preview' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async applyPreview(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.assignments.applyPreview(eventId);
  }

  @Post('events/:eventId/referee-assignments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign one referee to one pool role after validation' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async manualAssign(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: ManualAssignmentRequestDto,
  ) {
    return this.assignments.applyManual(eventId, dto);
  }

  @Post('referee-assignments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Legacy manual referee assignment endpoint' })
  async legacyManualAssign(@Body() dto: LegacyManualAssignmentRequestDto) {
    return this.assignments.applyManual(dto.eventId, dto);
  }
}
