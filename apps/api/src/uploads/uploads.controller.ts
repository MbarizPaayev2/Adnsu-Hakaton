import { Controller, Get, Param, Res, UseGuards, ForbiddenException, Req } from '@nestjs/common';
import type { Response, Request } from 'express';
import { AnySessionGuard } from './any-session.guard';
import { LocalStorageService } from '../resumes/local-storage.service';
import { UploadAccessService, type UploadPrincipal } from './upload-access.service';

@Controller('uploads')
@UseGuards(AnySessionGuard)
export class UploadsController {
  constructor(
    private storageService: LocalStorageService,
    private uploadAccess: UploadAccessService,
  ) {}

  @Get(':filename')
  async getFile(
    @Param('filename') filename: string,
    @Req() request: Request & { uploadPrincipal?: UploadPrincipal },
    @Res() res: Response,
  ) {
    const principal = request.uploadPrincipal;
    if (!principal || !(await this.uploadAccess.canRead(principal, filename))) {
      throw new ForbiddenException('Bu faylı oxumaq səlahiyyətiniz yoxdur');
    }

    const filePath = this.storageService.resolveForRead(filename);

    res.setHeader('Content-Disposition', 'attachment');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(filePath);
  }
}
