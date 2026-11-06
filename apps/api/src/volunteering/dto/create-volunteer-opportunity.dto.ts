import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateVolunteerOpportunityDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  description: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;
}
