import { DynamicModule, Module, Global, Provider } from '@nestjs/common';
import { LeaderElectionService } from './leader-election.service';
import { LEADER_ELECTION_OPTIONS, LeaderElectionOptions } from './leader-election-options.interface';

@Global()
@Module({})
export class LeaderElectionModule {
  static forRoot(options: LeaderElectionOptions): DynamicModule {
    return {
      module: LeaderElectionModule,
      providers: [
        {
          provide: LEADER_ELECTION_OPTIONS,
          useValue: options,
        },
        LeaderElectionService,
      ],
      exports: [LeaderElectionService],
    };
  }

  static forRootAsync(options: {
    useFactory: (...args: any[]) => Promise<LeaderElectionOptions> | LeaderElectionOptions;
    inject?: any[];
  }): DynamicModule {
    return {
      module: LeaderElectionModule,
      providers: [
        {
          provide: LEADER_ELECTION_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject || [],
        },
        LeaderElectionService,
      ],
      exports: [LeaderElectionService],
    };
  }
}
