import { IsString, IsOptional, IsInt, IsEmail, IsUrl, Min, Max } from 'class-validator';

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  name?: string;

  // The dedicated POST business/company/logo upload endpoint sets this
  // internally (calling CompaniesService.update() directly, which bypasses
  // this DTO/ValidationPipe entirely) to a server-generated /uploads/...
  // path. This validator only constrains what a client can set via this
  // PATCH endpoint directly — previously bare @IsString(), so any string at
  // all was accepted and rendered as an <img src> to every job seeker who
  // views this company.
  @IsOptional()
  @IsString()
  @IsUrl()
  logo?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @IsUrl()
  website?: string;

  @IsOptional()
  @IsString()
  industry?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  size?: string;

  @IsOptional()
  @IsInt()
  @Min(1800)
  @Max(new Date().getFullYear())
  foundedYear?: number;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  socialLinks?: any;
}
