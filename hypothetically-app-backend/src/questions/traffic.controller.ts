import { Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { TrafficService } from './traffic.service';

@Controller('traffic')
export class TrafficController {
  constructor(private readonly trafficService: TrafficService) {}

  @Post('visit')
  @HttpCode(204)
  async visit(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.trafficService.recordVisit(request, response);
  }
}
