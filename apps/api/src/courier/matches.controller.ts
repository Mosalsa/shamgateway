import { Body, Controller, Param, Post } from "@nestjs/common";
import { MatchesService } from "./matches.service";
import { MatchCreateDto } from "./dto/match-create.dto";

@Controller("courier/matches")
export class MatchesController {
  constructor(private svc: MatchesService) {}
  @Post() propose(@Body() dto: MatchCreateDto) {
    return this.svc.propose(dto);
  }
  @Post(":id/accept") accept(@Param("id") id: string) {
    return this.svc.accept(id);
  }
  @Post(":id/start") start(@Param("id") id: string) {
    return this.svc.start(id);
  }
  @Post(":id/confirm-delivered") delivered(@Param("id") id: string) {
    return this.svc.delivered(id);
  }
  @Post(":id/cancel") cancel(@Param("id") id: string) {
    return this.svc.cancel(id);
  }
}
