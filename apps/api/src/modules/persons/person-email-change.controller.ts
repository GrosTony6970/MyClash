import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../../common/auth/public.decorator';
import { RequestPersonEmailChangeDto } from './dto/person-email-change.dto';
import { PersonEmailChangeService } from './person-email-change.service';

@ApiTags('persons')
@Controller('persons/me/email-change')
export class PersonEmailChangeController {
  constructor(private readonly emailChange: PersonEmailChangeService) {}

  @Get()
  @ApiOperation({ summary: 'Get pending email-change request for the claimed Person account' })
  @ApiResponse({ status: 200, description: 'Pending request or null' })
  async getPending(@Req() req: FastifyRequest) {
    return this.emailChange.getPendingEmailChange(req);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request an email change for the claimed Person account' })
  @ApiResponse({ status: 200, description: 'Confirmation email sent to the new address' })
  @ApiResponse({ status: 401, description: 'Claimed account required' })
  @ApiResponse({ status: 409, description: 'Email already used in a claimed Person event' })
  async request(@Req() req: FastifyRequest, @Body() dto: RequestPersonEmailChangeDto) {
    return this.emailChange.requestEmailChange(req, dto);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel the pending email-change request' })
  async cancel(@Req() req: FastifyRequest): Promise<void> {
    await this.emailChange.cancelEmailChange(req);
  }

  /**
   * The emailed token is the credential; the link is opened before any session.
   * A browser lands here: it is sent to the participant sign-in page, which says
   * what became of the change (operator ruling 371).
   */
  @Public()
  @Get('confirm')
  @ApiOperation({
    summary: 'Confirm an email-change token sent to the new email address (public; token)',
  })
  @ApiResponse({ status: 302, description: 'Redirect to the sign-in page with the outcome' })
  async confirm(@Query('token') token: string, @Res() reply: FastifyReply): Promise<void> {
    void reply.redirect(await this.emailChange.pageAfterConfirm(token));
  }
}
