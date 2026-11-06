import { IsIn } from 'class-validator';
import type { MatchStatus } from '@aise/shared-types';

export class UpdateMatchStatusDto {
  @IsIn(['NEW', 'VIEWED', 'DISMISSED', 'APPLIED'])
  status: MatchStatus;
}
