import { IsArray, IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class JobPreferencesDto {
  @IsArray()
  @IsString({ each: true })
  roles: string[];

  @IsArray()
  @IsString({ each: true })
  locations: string[];

  @IsArray()
  @IsIn(['remote', 'onsite', 'hybrid'], { each: true })
  types: ('remote' | 'onsite' | 'hybrid')[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  salaryMin?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  salaryMax?: number;
}
