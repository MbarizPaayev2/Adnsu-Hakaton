import { Type } from 'class-transformer';
import { IsArray, IsDate, IsIn, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { JobPreferencesDto } from './job-preferences.dto';
import { ExperienceDto } from './experience.dto';
import { EducationDto } from './education.dto';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  headline?: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[];

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => JobPreferencesDto)
  jobPreferences?: JobPreferencesDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExperienceDto)
  experiences?: ExperienceDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EducationDto)
  education?: EducationDto[];

  // External job-application fields (glorri.az apply automation). idDocumentUrl
  // is deliberately NOT here — it's only ever set via the dedicated upload
  // endpoint (POST /profile/id-document), never accepted as a raw client-supplied
  // URL string in a JSON PATCH.
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dob?: Date;

  @IsOptional()
  @IsString()
  citizenship?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  salaryExpectation?: number;

  @IsOptional()
  @IsIn(['Net', 'Gross'])
  preferredNetGross?: string;

  @IsOptional()
  @IsIn(['AZN', 'USD', 'EUR'])
  preferredCurrency?: string;

  @IsOptional()
  @IsString()
  defaultCoverLetter?: string;
}
