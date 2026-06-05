import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/auth.guard';
import type { AuthenticatedRequest } from '../common/types';
import { PredictionsService } from './predictions.service';

@Controller('predictions')
@UseGuards(JwtAuthGuard)
export class PredictionsController {
  constructor(private readonly predictions: PredictionsService) {}

  @Get('me')
  mine(@Req() request: AuthenticatedRequest) {
    return this.predictions.getMine(request.user.id);
  }

  @Post('match')
  saveMatch(@Req() request: AuthenticatedRequest, @Body() body: { matchId: number; homeScore: number; awayScore: number }) {
    return this.predictions.saveMatchPrediction(request.user.id, body);
  }

  @Post('tournament')
  saveTournament(
    @Req() request: AuthenticatedRequest,
    @Body() body: { championTeamId: number; finalist1TeamId: number; finalist2TeamId: number }
  ) {
    return this.predictions.saveTournamentPrediction(request.user.id, body);
  }
}
