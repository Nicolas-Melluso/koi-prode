import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/auth.guard';
import { FixtureService } from './fixture.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class FixtureController {
  constructor(private readonly fixture: FixtureService) {}

  @Get('teams')
  teams(): Promise<any> {
    return this.fixture.listTeams();
  }

  @Get('matches')
  matches(): Promise<any> {
    return this.fixture.listMatches();
  }
}
