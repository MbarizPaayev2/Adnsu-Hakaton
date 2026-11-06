import { IsString, IsNotEmpty, IsEnum, IsBoolean, IsNumber, IsOptional, ValidateNested, IsArray } from 'class-validator';
import { Type } from 'class-transformer';

export enum QuestionType {
  SHORT_TEXT = 'SHORT_TEXT',
  LONG_TEXT = 'LONG_TEXT',
  YES_NO = 'YES_NO',
  MULTIPLE_CHOICE = 'MULTIPLE_CHOICE',
  NUMBER = 'NUMBER',
  FILE_UPLOAD = 'FILE_UPLOAD',
}

class QuestionOptionDto {
  @IsString()
  @IsNotEmpty()
  label: string;

  @IsNumber()
  order: number;
}

export class CreateQuestionDto {
  @IsString()
  @IsNotEmpty()
  label: string;

  @IsEnum(QuestionType)
  type: QuestionType;

  @IsBoolean()
  required: boolean;

  @IsNumber()
  order: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionDto)
  options?: QuestionOptionDto[];
}
