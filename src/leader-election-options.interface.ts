export interface LeaderElectionOptions {
  leaseName?: string;
  namespace?: string;
  renewalInterval?: number;
  logAtLevel: 'log' | 'debug'
  awaitLeadership?: boolean;
}

export const LEADER_ELECTION_OPTIONS = 'LEADER_ELECTION_OPTIONS';

export const LeaderElectedEvent = 'leader.elected';
export const LeaderLostEvent = 'leader.lost';
