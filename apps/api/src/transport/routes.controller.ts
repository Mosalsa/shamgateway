import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { RoutesService } from "./routes.service";
import { RouteCreateDto } from "./dto/route-create.dto";
import { RouteUpdateDto } from "./dto/route-update.dto";

@Controller("transport")
export class RoutesController {
  constructor(private svc: RoutesService) {}
  @Post("providers/:id/routes") create(
    @Param("id") providerId: string,
    @Body() dto: RouteCreateDto
  ) {
    return this.svc.create(providerId, dto);
  }
  @Get("providers/:id/routes") list(@Param("id") providerId: string) {
    return this.svc.list(providerId);
  }
  @Patch("routes/:routeId") upd(
    @Param("routeId") routeId: string,
    @Body() dto: RouteUpdateDto
  ) {
    return this.svc.update(routeId, dto);
  }
  @Delete("routes/:routeId") del(@Param("routeId") routeId: string) {
    return this.svc.remove(routeId);
  }
}
