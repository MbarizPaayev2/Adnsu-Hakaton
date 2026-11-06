import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateAcademyDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[a-z0-9-]+$/, { message: 'Slug can only contain lowercase letters, numbers, and hyphens' })
  slug!: string;

  @IsEmail()
  @IsNotEmpty()
  contactEmail!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  website?: string;
}

export class UpdateAcademyDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  website?: string;
}
