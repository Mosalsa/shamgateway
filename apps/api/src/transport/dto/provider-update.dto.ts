import { PartialType } from "@nestjs/mapped-types";
import { ProviderCreateDto } from "./provider-create.dto";
export class ProviderUpdateDto extends PartialType(ProviderCreateDto) {}
