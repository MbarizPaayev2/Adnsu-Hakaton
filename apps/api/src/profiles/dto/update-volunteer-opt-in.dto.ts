import { IsBoolean } from 'class-validator';

export class UpdateVolunteerOptInDto {
  @IsBoolean()
  enabled: boolean;
}
