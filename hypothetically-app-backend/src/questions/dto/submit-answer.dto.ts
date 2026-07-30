import { IsNumber, IsOptional, IsString } from 'class-validator';

export class SubmitAnswerDto {
  @IsNumber({ allowInfinity: false, allowNaN: false })
  value!: number;

  @IsOptional()
  @IsString()
  timeZone?: string;
}
