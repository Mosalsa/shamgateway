// apps/api/src/bookings/bookings.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { BookingsService } from "./bookings.service";
import { BookOrderDto } from "./dto/book-order.dto";

@Controller("bookings")
@UseGuards(JwtAuthGuard)
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  async book(@Body() dto: BookOrderDto, @Req() req: any) {
    const userId = req?.user?.id;
    if (!userId) {
      throw new BadRequestException("Missing authenticated user");
    }

    return this.bookings.book(dto, userId);
  }
}
