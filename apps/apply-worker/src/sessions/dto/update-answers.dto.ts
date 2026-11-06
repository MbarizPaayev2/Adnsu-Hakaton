import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class AnswerUpdateDto {
  @IsString()
  fieldKey: string;

  @IsString()
  value: string;
}

export class UpdateAnswersDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AnswerUpdateDto)
  answers: AnswerUpdateDto[];

  @IsOptional()
  @IsString()
  motivationLetter?: string;
}
