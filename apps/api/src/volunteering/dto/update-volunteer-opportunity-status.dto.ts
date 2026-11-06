import { IsIn } from 'class-validator';

export class UpdateVolunteerOpportunityStatusDto {
  @IsIn(['ACTIVE', 'CLOSED'])
  status: 'ACTIVE' | 'CLOSED';
}
