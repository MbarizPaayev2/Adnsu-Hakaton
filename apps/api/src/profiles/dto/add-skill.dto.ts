import { Equals, IsBoolean, IsString, MaxLength, MinLength } from 'class-validator';

/** One skill the candidate states they have. `confirmed` must be true: nothing is added from a posting without the candidate's own confirmation. */
export class AddSkillDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  skill: string;

  @IsBoolean()
  @Equals(true, { message: 'Bacarıq yalnız sizin təsdiqinizlə əlavə olunur' })
  confirmed: boolean;
}
