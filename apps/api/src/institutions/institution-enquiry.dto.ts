import { Equals, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class InstitutionEnquiryDto {
  @IsString() @MinLength(2) @MaxLength(160)
  organization: string;

  @IsString() @MinLength(2) @MaxLength(120)
  contactName: string;

  @IsOptional() @IsString() @MaxLength(120)
  role?: string;

  @IsEmail() @MaxLength(200)
  email: string;

  @IsOptional() @IsString() @MaxLength(40)
  phone?: string;

  @IsOptional() @IsInt() @Min(1) @Max(2000)
  cohortSize?: number;

  @IsOptional() @IsIn(['this_month', 'next_month', 'later', 'exploring'])
  timing?: 'this_month' | 'next_month' | 'later' | 'exploring';

  @IsOptional() @IsString() @MaxLength(2000)
  message?: string;

  /** Consent to be contacted about this enquiry only. */
  @IsBoolean() @Equals(true, { message: 'Əlaqə üçün razılıq lazımdır' })
  consent: boolean;

  /** Honeypot: people never fill it. */
  @IsOptional() @IsString() @MaxLength(200)
  website?: string;
}
