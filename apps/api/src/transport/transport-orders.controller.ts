import { Body, Controller, Post } from "@nestjs/common";
import { TransportOrdersService } from "./transport-orders.service";
import { TransportQuoteDto } from "./dto/quote.dto";
import { TransportReserveDto } from "./dto/reserve.dto";
import { TransportConfirmDto } from "./dto/confirm.dto";
import { TransportCancelDto } from "./dto/cancel.dto";

@Controller("transport")
export class TransportOrdersController {
  constructor(private svc: TransportOrdersService) {}

  @Post("quote") quote(@Body() dto: TransportQuoteDto) {
    return this.svc.quote(dto);
  }
  @Post("reserve") reserve(@Body() dto: TransportReserveDto) {
    return this.svc.reserve(dto);
  }
  @Post("confirm") confirm(@Body() dto: TransportConfirmDto) {
    return this.svc.confirm(dto.ground_transport_order_id);
  }
  @Post("cancel") cancel(@Body() dto: TransportCancelDto) {
    return this.svc.cancel(dto.ground_transport_order_id, dto.reason);
  }
}
