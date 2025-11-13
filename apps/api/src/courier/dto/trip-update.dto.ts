import { PartialType } from "@nestjs/mapped-types";
import { TripCreateDto } from "./trip-create.dto";
export class TripUpdateDto extends PartialType(TripCreateDto) {}
