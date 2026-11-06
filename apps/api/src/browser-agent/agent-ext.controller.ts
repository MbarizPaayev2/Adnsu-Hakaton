import { Body, CanActivate, Controller, ExecutionContext, Get, Header, HttpCode, Injectable, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AgentService, type DeviceCtx } from './agent.service';

/** The browser extension authenticates with the device token it received when the candidate paired it; that token reaches only the candidate's own agent work. */
@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(private readonly agent: AgentService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    req.agentDevice = await this.agent.authenticate(header?.startsWith('Bearer ') ? header.slice(7) : undefined, req.headers['x-aise-extension-version']);
    return true;
  }
}

type Req = { agentDevice: DeviceCtx };

@Controller('agent/ext')
export class AgentExtController {
  constructor(private readonly service: AgentService) {}

  // Pairing is the only route without a device token: it exchanges a short-lived code the signed-in candidate created.
  @Post('pair') @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60_000 } })
  pair(@Body() body: { code?: unknown; name?: unknown; version?: unknown }) { return this.service.pair(body?.code, body?.name, body?.version); }

  @Get('assisted-profile') @UseGuards(DeviceAuthGuard) @Header('Cache-Control', 'private, no-store')
  assistedProfile(@Req() req: Req) { return this.service.assistedProfile(req.agentDevice); }

  @Get('assisted-letter') @UseGuards(DeviceAuthGuard) @Header('Cache-Control', 'private, no-store') @Throttle({ default: { limit: 30, ttl: 60_000 } })
  assistedLetter(@Req() req: Req, @Query('url') url: unknown) { return this.service.assistedLetter(req.agentDevice, url); }

  @Get('next') @UseGuards(DeviceAuthGuard) @Throttle({ default: { limit: 60, ttl: 60_000 } })
  next(@Req() req: Req) { return this.service.next(req.agentDevice); }

  @Post('applications/:id/describe') @HttpCode(200) @UseGuards(DeviceAuthGuard)
  describe(@Req() req: Req, @Param('id') id: string, @Body() body: { pageState?: unknown; fields?: unknown; declarationText?: unknown }) { return this.service.describe(req.agentDevice, id, body); }

  @Get('applications/:id/attachment') @UseGuards(DeviceAuthGuard)
  async attachment(@Req() req: Req, @Param('id') id: string, @Res() res: Response) {
    const f = await this.service.attachment(req.agentDevice, id);
    res.set({ 'Content-Type': f.mimeType, 'Content-Disposition': `attachment; filename="${f.filename}"`, 'X-Content-Sha256': f.sha256, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    res.send(f.bytes);
  }

  @Post('applications/:id/heartbeat') @HttpCode(200) @UseGuards(DeviceAuthGuard) @Throttle({ default: { limit: 120, ttl: 60_000 } })
  heartbeat(@Req() req: Req, @Param('id') id: string) { return this.service.heartbeat(req.agentDevice, id); }

  @Post('applications/:id/permit') @HttpCode(200) @UseGuards(DeviceAuthGuard)
  permit(@Req() req: Req, @Param('id') id: string, @Body() body: { planHash?: unknown; declarationHash?: unknown; missingRequired?: unknown; mismatched?: unknown }) { return this.service.permit(req.agentDevice, id, body); }

  @Post('applications/:id/blocked') @HttpCode(200) @UseGuards(DeviceAuthGuard)
  blocked(@Req() req: Req, @Param('id') id: string, @Body() body: { reason?: unknown; phase?: unknown; permitId?: unknown }) { return this.service.blocked(req.agentDevice, id, body); }

  @Post('applications/:id/evidence') @HttpCode(200) @UseGuards(DeviceAuthGuard)
  evidence(@Req() req: Req, @Param('id') id: string, @Body() body: { permitId?: unknown; confirmationUrl?: unknown; textSha256?: unknown; portalReference?: unknown }) { return this.service.evidence(req.agentDevice, id, body); }
}
