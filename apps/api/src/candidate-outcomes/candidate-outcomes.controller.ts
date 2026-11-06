import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { GetUser } from '../auth/get-user.decorator';
import { CandidateOutcomesService } from './candidate-outcomes.service';
import { ReportCandidateOutcomeDto, UpdateCandidateOutcomeDto } from './dto/candidate-outcome.dto';

@Controller('candidate/outcomes')
@UseGuards(SessionAuthGuard)
export class CandidateOutcomesController {
  constructor(private readonly service: CandidateOutcomesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  reportOutcome(
    @GetUser('id') userId: string,
    @Body() dto: ReportCandidateOutcomeDto,
  ) {
    return this.service.reportOutcome(userId, dto);
  }

  @Get()
  listOutcomes(@GetUser('id') userId: string) {
    return this.service.listOutcomes(userId);
  }

  @Get(':id')
  getOutcome(
    @GetUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.service.getOutcome(userId, id);
  }

  @Patch(':id')
  updateOutcome(
    @GetUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCandidateOutcomeDto,
  ) {
    return this.service.updateOutcome(userId, id, dto);
  }

  @Post(':id/withdraw')
  withdrawOutcome(
    @GetUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.service.withdrawOutcome(userId, id);
  }

  @Delete(':id')
  deleteOutcome(
    @GetUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.service.deleteOutcome(userId, id);
  }
}
