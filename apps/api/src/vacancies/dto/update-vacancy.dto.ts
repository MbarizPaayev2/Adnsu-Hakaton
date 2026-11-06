import { IsEmail, MaxLength, IsString, IsOptional, IsArray, IsNumber, IsDateString, Min, ValidateNested, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateQuestionDto } from './create-question.dto';

export class UpdateVacancyDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  responsibilities?: string;

  @IsOptional()
  @IsString()
  requirements?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[];

  @IsOptional()
  @IsString()
  experienceLevel?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  salaryMin?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  salaryMax?: number;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  workArrangement?: string;

  @IsOptional()
  @IsString()
  employmentType?: string;

  @IsOptional()
  @IsDateString()
  deadline?: string;

  /** Where to be told about new applications (a link into the AISE inbox; no CV is attached). Empty string clears it. */
  @IsOptional()
  @ValidateIf((_, v) => v !== '' && v !== null)
  @IsEmail()
  @MaxLength(254)
  applicationEmail?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateQuestionDto)
  questions?: CreateQuestionDto[];
}
