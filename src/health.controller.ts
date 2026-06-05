import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      app: 'koi-prode',
      timestamp: new Date().toISOString()
    };
  }
}
