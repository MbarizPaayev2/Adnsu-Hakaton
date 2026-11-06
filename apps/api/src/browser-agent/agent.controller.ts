import { Body, Controller, Header, StreamableFile, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { GetUser } from '../auth/get-user.decorator';
import { AgentService } from './agent.service';

/** Candidate-facing browser agent: campaigns (the candidate's own authority), devices and applications. Every route is scoped to the signed-in candidate. */
@Controller('agent')
@UseGuards(SessionAuthGuard)
export class AgentController {
  constructor(private readonly service: AgentService) {}

  @Get('extension')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async extension(@GetUser('id') userId: string) {
    return new StreamableFile(await this.service.extensionArchive(userId), {
      type: 'application/zip', disposition: 'attachment; filename="aise-agent-extension.zip"',
    });
  }

  @Get('capabilities') capabilities(@GetUser('id') userId: string) { return this.service.capabilities(userId); }

  @Post('pairing') @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60_000 } })
  pairing(@GetUser('id') userId: string) { return this.service.createPairingCode(userId); }
  @Get('devices') devices(@GetUser('id') userId: string) { return this.service.listDevices(userId); }
  @Delete('devices/:id') revokeDevice(@GetUser('id') userId: string, @Param('id') id: string) { return this.service.revokeDevice(userId, id); }

  @Post('campaigns/preview') @HttpCode(200) preview(@GetUser('id') userId: string, @Body() body: unknown) { return this.service.previewCampaign(userId, body); }
  @Post('campaigns') @HttpCode(201) create(@GetUser('id') userId: string, @Body() body: { scope?: unknown; consentHash?: unknown; acknowledged?: unknown }) { return this.service.createCampaign(userId, body?.scope, { consentHash: body?.consentHash, acknowledged: body?.acknowledged }); }
  @Get('campaigns') campaigns(@GetUser('id') userId: string) { return this.service.listCampaigns(userId); }
  @Get('campaigns/:id') campaign(@GetUser('id') userId: string, @Param('id') id: string) { return this.service.getCampaign(userId, id); }
  @Post('campaigns/:id/pause') @HttpCode(200) pause(@GetUser('id') userId: string, @Param('id') id: string) { return this.service.campaignAction(userId, id, 'pause'); }
  @Post('campaigns/:id/resume') @HttpCode(200) resume(@GetUser('id') userId: string, @Param('id') id: string) { return this.service.campaignAction(userId, id, 'resume'); }
  @Post('campaigns/:id/revoke') @HttpCode(200) revoke(@GetUser('id') userId: string, @Param('id') id: string) { return this.service.campaignAction(userId, id, 'revoke'); }
  @Post('campaigns/:id/stop') @HttpCode(200) stop(@GetUser('id') userId: string, @Param('id') id: string) { return this.service.campaignAction(userId, id, 'stop'); }
  @Post('stop-all') @HttpCode(200) stopAll(@GetUser('id') userId: string) { return this.service.stopAll(userId); }
  @Post('campaigns/:id/discover') @HttpCode(200) discover(@GetUser('id') userId: string, @Param('id') id: string) { return this.service.discover(userId, id); }

  @Get('applications') applications(@GetUser('id') userId: string) { return this.service.listApplications(userId); }
  @Get('applications/:id') application(@GetUser('id') userId: string, @Param('id') id: string) { return this.service.getApplication(userId, id); }
  @Post('applications/:id/answers') @HttpCode(200) answer(@GetUser('id') userId: string, @Param('id') id: string, @Body() body: { answers?: unknown; remember?: unknown }) { return this.service.answer(userId, id, body); }
  @Post('applications/:id/approve') @HttpCode(200) approve(@GetUser('id') userId: string, @Param('id') id: string, @Body() body: { planHash?: unknown }) { return this.service.approve(userId, id, body); }
  @Post('applications/:id/cancel') @HttpCode(200) cancel(@GetUser('id') userId: string, @Param('id') id: string) { return this.service.cancel(userId, id); }
  @Post('applications/:id/reconcile') @HttpCode(200) reconcile(@GetUser('id') userId: string, @Param('id') id: string, @Body() body: { outcome?: unknown }) { return this.service.reconcile(userId, id, body); }
}
