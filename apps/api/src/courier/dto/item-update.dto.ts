import { PartialType } from "@nestjs/mapped-types";
import { ItemCreateDto } from "./item-create.dto";
export class ItemUpdateDto extends PartialType(ItemCreateDto) {}
