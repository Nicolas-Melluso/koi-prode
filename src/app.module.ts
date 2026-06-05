import { Module } from '@nestjs/common';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AdminGuard, JwtAuthGuard } from './common/auth.guard';
import { DbService } from './common/db.service';
import { FixtureController } from './fixture/fixture.controller';
import { FixtureService } from './fixture/fixture.service';
import { HealthController } from './health.controller';
import { NotificationsController } from './notifications/notifications.controller';
import { NotificationsService } from './notifications/notifications.service';
import { PredictionsController } from './predictions/predictions.controller';
import { PredictionsService } from './predictions/predictions.service';
import { ScoringController } from './scoring/scoring.controller';
import { ScoringService } from './scoring/scoring.service';

@Module({
  controllers: [
    AdminController,
    AuthController,
    FixtureController,
    HealthController,
    NotificationsController,
    PredictionsController,
    ScoringController
  ],
  providers: [
    AdminGuard,
    AdminService,
    AuthService,
    DbService,
    FixtureService,
    JwtAuthGuard,
    NotificationsService,
    PredictionsService,
    ScoringService
  ]
})
export class AppModule {}
