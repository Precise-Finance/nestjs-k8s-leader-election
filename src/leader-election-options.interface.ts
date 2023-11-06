export interface LeaderElectionOptions {
  leaseName?: string;
  namespace?: string;
  renewalInterval?: number;
}

export const LEADER_ELECTION_OPTIONS = 'LEADER_ELECTION_OPTIONS';