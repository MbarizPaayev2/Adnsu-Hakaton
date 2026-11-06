import { IsOptional, IsString } from 'class-validator';

export class TailorResumeDto {
  @IsString()
  matchId: string;

  @IsOptional()
  @IsString()
  baseResumeId?: string;
}
