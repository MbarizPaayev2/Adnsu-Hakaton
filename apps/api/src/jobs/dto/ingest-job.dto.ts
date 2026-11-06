import { IsISO8601, IsObject, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

/** Collectors reject (never silently truncate) a longer description. */
export const MAX_JOB_DESCRIPTION_CHARS = 40_000;

export class IngestJobDto {
  @IsString()
  @MaxLength(256)
  externalId: string;

  @IsString()
  @MaxLength(500)
  title: string;

  @IsString()
  @MaxLength(256)
  company: string;

  @IsString()
  @MaxLength(MAX_JOB_DESCRIPTION_CHARS)
  description: string;

  @IsString()
  @MaxLength(256)
  location: string;

  @IsUrl({ require_tld: false })
  url: string;

  @IsISO8601()
  postedAt: string;

  // Application deadline stated by the source, if any.
  @IsOptional()
  @IsISO8601()
  deadline?: string;

  // When the detail page backing description/deadline was fetched.
  @IsOptional()
  @IsISO8601()
  detailFetchedAt?: string;

  @IsOptional()
  @IsObject()
  rawPayload?: Record<string, any>;
}
