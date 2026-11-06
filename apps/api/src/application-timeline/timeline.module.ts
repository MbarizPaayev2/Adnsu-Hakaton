import { TrackerController } from './tracker.controller';
import { TrackerService } from './tracker.service';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OutcomeStatsService } from './outcome-stats.service';
import { TimelineController } from './timeline.controller';
import { TimelineService } from './timeline.service';

@Module({ imports: [AuthModule], controllers: [TimelineController, TrackerController], providers: [TrackerService, TimelineService, OutcomeStatsService], exports: [TimelineService, OutcomeStatsService] })
export class TimelineModule {}
