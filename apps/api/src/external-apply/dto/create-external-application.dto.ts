import { IsString } from 'class-validator';

export class CreateExternalApplicationDto {
  @IsString()
  matchId: string;
}
