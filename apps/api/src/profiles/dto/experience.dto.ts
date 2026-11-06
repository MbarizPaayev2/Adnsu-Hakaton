import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

export class ExperienceDto {
  @IsString()
  title: string;

  @IsString()
  company: string;

  @IsDateString()
  startDate: string;

  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  location?: string | null;

  /** "YEAR" when only the year is known; omitted or "MONTH" otherwise. */
  @IsOptional()
  @IsIn(['YEAR', 'MONTH'])
  startPrecision?: 'YEAR' | 'MONTH' | null;

  @IsOptional()
  @IsIn(['YEAR', 'MONTH'])
  endPrecision?: 'YEAR' | 'MONTH' | null;
}
