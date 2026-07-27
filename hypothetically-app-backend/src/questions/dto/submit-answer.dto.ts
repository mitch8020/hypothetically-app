import { IsNumber } from 'class-validator';

export class SubmitAnswerDto {
  @IsNumber({ allowInfinity: false, allowNaN: false })
  value!: number;
}
