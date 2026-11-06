import { ArrayMaxSize, ArrayNotEmpty, Equals, IsArray, IsBoolean, IsString } from 'class-validator';

/** Multiple skills the candidate states they have. `confirmed` must be true: nothing is added from a posting without candidate's own confirmation. */
export class AddBulkSkillsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  skills: string[];

  @IsBoolean()
  @Equals(true, { message: 'Bacarıqlar yalnız sizin təsdiqinizlə əlavə olunur' })
  confirmed: boolean;
}
