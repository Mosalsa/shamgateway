import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ProvidersService } from "./providers.service";
import { ProviderCreateDto } from "./dto/provider-create.dto";
import { ProviderUpdateDto } from "./dto/provider-update.dto";

@Controller("transport/providers")
export class ProvidersController {
  constructor(private svc: ProvidersService) {}
  @Post() create(@Body() dto: ProviderCreateDto) {
    return this.svc.create(dto);
  }
  @Get() list(@Query("active") active?: string) {
    return this.svc.list(
      active === "true" ? true : active === "false" ? false : undefined
    );
  }
  @Get(":id") get(@Param("id") id: string) {
    return this.svc.get(id);
  }
  @Patch(":id") upd(@Param("id") id: string, @Body() dto: ProviderUpdateDto) {
    return this.svc.update(id, dto);
  }
  @Delete(":id") del(@Param("id") id: string) {
    return this.svc.remove(id);
  }
}
