import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

class ExternalApplicationAnswerDto {
  @IsString()
  @MaxLength(200)
  fieldKey: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  value: string;
}

export class SubmitAnswersDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ExternalApplicationAnswerDto)
  answers: ExternalApplicationAnswerDto[];

  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(5000)
  motivationLetter?: string;
}
