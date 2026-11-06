import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class ApproveTailoredDto {
  @IsOptional()
  @IsBoolean()
  acknowledgeUntranslated?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  reviewedRevision?: number;
}
