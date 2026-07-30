import { Module } from '@nestjs/common';
import { FxService } from './fx.service';
import { FX_PROVIDER } from './interfaces/fx-provider.interface';
import { PublicApiFxProvider } from './providers/public-api-fx.provider';

@Module({
  providers: [FxService, { provide: FX_PROVIDER, useClass: PublicApiFxProvider }],
  exports: [FxService],
})
export class FxModule {}
