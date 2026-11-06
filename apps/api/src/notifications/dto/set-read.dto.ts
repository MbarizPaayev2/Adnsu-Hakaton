import { IsBoolean, IsOptional } from 'class-validator';

export class SetReadDto {
  @IsOptional()
  @IsBoolean()
  read?: boolean;
}
