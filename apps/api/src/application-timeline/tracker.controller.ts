import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { GetUser } from '../auth/get-user.decorator';
import { TrackerService } from './tracker.service';

@Controller('application-tracker')
@UseGuards(SessionAuthGuard)
export class TrackerController {
  constructor(private service: TrackerService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(
    @GetUser('id') userId: string,
    @Query()
    query: {
      q?: string;
      stage?: string;
      group?: string;
      page?: string;
      hidden?: string;
    },
  ) {
    return this.service.list(userId, query);
  }
  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="aise-applications.csv"')
  @Header('Cache-Control', 'private, no-store')
  csv(@GetUser('id') userId: string) {
    return this.service.csv(userId);
  }
  @Post() create(@GetUser('id') userId: string, @Body() body: unknown) {
    return this.service.create(userId, body);
  }
  @Put('columns') columns(
    @GetUser('id') userId: string,
    @Body() body: { columns?: unknown },
  ) {
    return this.service.configure(userId, body?.columns);
  }
  @Patch(':key') edit(
    @GetUser('id') userId: string,
    @Param('key') key: string,
    @Body() body: unknown,
  ) {
    return this.service.edit(userId, key, body);
  }
}
