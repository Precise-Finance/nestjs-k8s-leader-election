import { Test, TestingModule } from '@nestjs/testing';
import { LeaderElectionService } from './leader-election.service';
import { EventEmitter2 } from '@nestjs/event-emitter';


describe('LeaderElectionService', () => {
  let service: LeaderElectionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaderElectionService,
        EventEmitter2, // Assuming we're using EventEmitter2 directly
        {
          provide: 'LEADER_ELECTION_OPTIONS',
          useValue: {
            leaseName: 'test-lease',
            namespace: 'test-namespace',
            renewalInterval: 10000,
          },
        },
      ],
    }).compile();

    service = module.get<LeaderElectionService>(LeaderElectionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
