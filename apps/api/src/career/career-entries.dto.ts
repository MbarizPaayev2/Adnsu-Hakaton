import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min, MinLength } from 'class-validator';

export const CAREER_KINDS = ['PROJECT', 'VOLUNTEERING', 'LEADERSHIP', 'EXTRACURRICULAR', 'CERTIFICATION', 'LANGUAGE', 'AWARD', 'STORY', 'OTHER'] as const;
export type CareerKindName = (typeof CAREER_KINDS)[number];

/** Free text from the candidate: control characters removed, surrounding space trimmed; an empty string means "not stated" (null). */
const clean = () => Transform(({ value }) => (typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim() || null : value));

class CareerEntryFields {
  @IsOptional() @clean() @IsString() @MaxLength(160) organization?: string | null;
  @IsOptional() @clean() @IsString() @MaxLength(120) role?: string | null;
  @IsOptional() @IsDateString() startDate?: string | null;
  @IsOptional() @IsDateString() endDate?: string | null;
  @IsOptional() @IsBoolean() current?: boolean;
  @IsOptional() @IsIn(['YEAR', 'MONTH']) datePrecision?: 'YEAR' | 'MONTH';
  @IsOptional() @IsDateString() issuedAt?: string | null;
  @IsOptional() @clean() @IsString() @MaxLength(40) level?: string | null;
  @IsOptional() @clean() @IsString() @MaxLength(1500) description?: string | null;
  @IsOptional() @clean() @IsString() @MaxLength(800) result?: string | null;
  @IsOptional() @clean() @IsString() @MaxLength(800) situation?: string | null;
  @IsOptional() @clean() @IsString() @MaxLength(800) action?: string | null;
  @IsOptional() @clean() @IsUrl({ protocols: ['http', 'https'], require_protocol: true }) @MaxLength(300) url?: string | null;
  @IsOptional() @IsBoolean() alwaysInclude?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(1000) sortOrder?: number;
}

export class CreateCareerEntryDto extends CareerEntryFields {
  @IsIn(CAREER_KINDS) kind: CareerKindName;
  @clean() @IsString() @MinLength(1) @MaxLength(160) title: string;
  @IsOptional() @IsIn(['SUGGESTED', 'CONFIRMED']) status?: 'SUGGESTED' | 'CONFIRMED';
}

export class UpdateCareerEntryDto extends CareerEntryFields {
  @IsOptional() @clean() @IsString() @MinLength(1) @MaxLength(160) title?: string;
  @IsOptional() @IsIn(['SUGGESTED', 'CONFIRMED', 'HIDDEN']) status?: 'SUGGESTED' | 'CONFIRMED' | 'HIDDEN';
}

export class ReviewCareerEntriesDto {
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) confirm?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) hide?: string[];
}

export { IsEnum };
