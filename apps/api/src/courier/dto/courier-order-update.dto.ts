import { PartialType } from "@nestjs/mapped-types";
import { CourierOrderCreateDto } from "./courier-order-create.dto";
export class CourierOrderUpdateDto extends PartialType(CourierOrderCreateDto) {}
