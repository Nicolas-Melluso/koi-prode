import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AdminGuard, JwtAuthGuard } from '../common/auth.guard';
import type { AuthenticatedRequest } from '../common/types';
import { AdminService } from './admin.service';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Post('import/worldcup26/preview')
  previewWorldCup26Import(@Req() request: AuthenticatedRequest) {
    return this.admin.previewWorldCup26Import(request.user);
  }

  @Post('import/worldcup26')
  importWorldCup26(@Req() request: AuthenticatedRequest) {
    return this.admin.importWorldCup26(request.user);
  }

  @Post('locks/recalculate')
  recalculateLocks(@Req() request: AuthenticatedRequest) {
    return this.admin.recalculateLocks(request.user);
  }

  @Patch('matches/:id/result')
  updateResult(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { homeScore: number; awayScore: number; homeTeamId?: number; awayTeamId?: number }
  ) {
    return this.admin.updateMatchResult(request.user, Number(id), body);
  }

  @Post('scores/recalculate')
  recalculateScores(@Req() request: AuthenticatedRequest) {
    return this.admin.recalculateScores(request.user);
  }

  @Get('users')
  users() {
    return this.admin.users();
  }

  @Get('predictions')
  predictions() {
    return this.admin.predictions();
  }

  @Get('notifications')
  notifications() {
    return this.admin.listNotifications();
  }

  @Post('notifications')
  createNotification(
    @Req() request: AuthenticatedRequest,
    @Body()
    body: {
      title: string;
      body: string;
      channel: 'banner' | 'email' | 'banner_email';
      targetArea?: string | null;
      startsAt?: string | null;
      endsAt?: string | null;
    }
  ) {
    return this.admin.createNotification(request.user, body);
  }

  @Delete('notifications/:id')
  deleteNotification(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.admin.deleteNotification(request.user, Number(id));
  }
}
