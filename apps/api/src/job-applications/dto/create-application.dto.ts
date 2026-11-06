import { IsString, IsOptional, ValidateNested, IsArray, IsEnum } from 'class-validator';
import { Transform, Type } from 'class-transformer';

function parseMultipartJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

class ApplicationAnswerDto {
  @IsString()
  questionId: string;

  @IsOptional()
  @IsString()
  value?: string;
}

export class CreateApplicationDto {
  @IsOptional()
  @IsString()
  resumeId?: string;

  @IsOptional()
  @IsArray()
  @Transform(({ value }) => parseMultipartJson(value))
  @ValidateNested({ each: true })
  @Type(() => ApplicationAnswerDto)
  answers?: ApplicationAnswerDto[];

  @IsOptional()
  @IsArray()
  @Transform(({ value }) => parseMultipartJson(value))
  @IsString({ each: true })
  fileQuestionIds?: string[];
}

export enum ApplicationStatus {
  APPLIED = 'APPLIED',
  REVIEWING = 'REVIEWING',
  INTERVIEW = 'INTERVIEW',
  HIRED = 'HIRED',
  REJECTED = 'REJECTED'
}

export class UpdateApplicationStatusDto {
  @IsEnum(ApplicationStatus)
  status: ApplicationStatus;
}
