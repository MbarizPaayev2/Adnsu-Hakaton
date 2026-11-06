import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CandidateOutcomesService } from './candidate-outcomes.service';
import { CandidateOutcomesController } from './candidate-outcomes.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [CandidateOutcomesController],
  providers: [CandidateOutcomesService],
  exports: [CandidateOutcomesService],
})
export class CandidateOutcomesModule {}
