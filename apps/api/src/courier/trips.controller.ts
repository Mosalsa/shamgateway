import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { TripsService } from "./trips.service";
import { TripCreateDto } from "./dto/trip-create.dto";
import { TripUpdateDto } from "./dto/trip-update.dto";

@Controller("courier/trips")
export class TripsController {
  constructor(private svc: TripsService) {}

  @Post()
  create(@Body() dto: TripCreateDto, @Req() req: any) {
    const userId = req.user?.id ?? dto.userId;
    return this.svc.create(userId, dto);
  }

  @Get() list(@Query() q: any) {
    return this.svc.list(q);
  }
  @Patch(":id") upd(@Param("id") id: string, @Body() dto: TripUpdateDto) {
    return this.svc.update(id, dto);
  }
  @Delete(":id") del(@Param("id") id: string) {
    return this.svc.delete(id);
  }
}
