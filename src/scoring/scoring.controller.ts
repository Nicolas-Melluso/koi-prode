import { Controller, Get, Param, ParseIntPipe, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/auth.guard';
import type { AuthenticatedRequest } from '../common/types';
import { ScoringService } from './scoring.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class ScoringController {
  constructor(private readonly scoring: ScoringService) {}

  @Get('ranking')
  ranking(): Promise<any> {
    return this.scoring.ranking();
  }

  @Get('ranking/:userId')
  rankingDetail(@Req() request: AuthenticatedRequest, @Param('userId', ParseIntPipe) userId: number): Promise<any> {
    return this.scoring.rankingDetail(userId, request.user.id);
  }

  @Get('profile')
  profile(@Req() request: AuthenticatedRequest): Promise<any> {
    return this.scoring.profile(request.user.id);
  }
}
