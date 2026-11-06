import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

export class EducationDto {
  @IsString()
  institution: string;

  @IsString()
  degree: string;

  @IsString()
  fieldOfStudy: string;

  @IsOptional()
  @IsString()
  location?: string | null;

  /** Absent when the record states no dates: an undated course or school is saved undated, never with today's date. */
  @IsOptional()
  @IsDateString()
  startDate?: string | null;

  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  /** "YEAR" when only the year is known; omitted or "MONTH" otherwise. */
  @IsOptional()
  @IsIn(['YEAR', 'MONTH'])
  startPrecision?: 'YEAR' | 'MONTH' | null;

  @IsOptional()
  @IsIn(['YEAR', 'MONTH'])
  endPrecision?: 'YEAR' | 'MONTH' | null;
}
