import { ArrayMaxSize, ArrayMinSize, IsArray, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class ConfirmListedDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @MaxLength(256, { each: true })
  externalIds: string[];

  @IsOptional()
  @IsISO8601()
  listedAt?: string;
}
