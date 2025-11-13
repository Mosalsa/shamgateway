import { PartialType } from "@nestjs/mapped-types";
import { RouteCreateDto } from "./route-create.dto";
export class RouteUpdateDto extends PartialType(RouteCreateDto) {}
