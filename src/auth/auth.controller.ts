import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/auth.guard';
import type { AuthenticatedRequest, LoginBody, RegisterBody } from '../common/types';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() body: RegisterBody) {
    return this.auth.register(body);
  }

  @Post('login')
  login(@Body() body: LoginBody) {
    return this.auth.login(body);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() request: AuthenticatedRequest) {
    return {
      user: request.user,
      areas: await this.auth.getAreas(request.user.id)
    };
  }
}
