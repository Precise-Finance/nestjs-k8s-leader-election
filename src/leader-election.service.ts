import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  Inject
} from '@nestjs/common';
import {
  KubeConfig,
  CoordinationV1Api,
  V1Lease,
  V1ObjectMeta,
  V1LeaseSpec,
  Watch,
  V1MicroTime
} from '@kubernetes/client-node';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LeaderElectedEvent, LeaderElectionOptions, LeaderLostEvent } from './leader-election-options.interface';

@Injectable()
export class LeaderElectionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(LeaderElectionService.name);
  private kubeClient: CoordinationV1Api;
  private watch: Watch;
  private leaseName: string;
  private namespace: string;
  private renewalInterval: number;
  private durationInSeconds: number;
  private isLeader = false;
  private logAtLevel: 'log' | 'debug';
  private leaseRenewalTimeout: NodeJS.Timeout | null = null;

  constructor(
    @Inject('LEADER_ELECTION_OPTIONS') private options: LeaderElectionOptions,
    private readonly eventEmitter: EventEmitter2
  ) {
    const kubeConfig = new KubeConfig();
    kubeConfig.loadFromDefault();
    this.kubeClient = kubeConfig.makeApiClient(CoordinationV1Api);
    this.watch = new Watch(kubeConfig);

    this.leaseName = options.leaseName ?? 'nestjs-leader-election';
    this.namespace = options.namespace ?? 'default';
    this.renewalInterval = options.renewalInterval ?? 10000;
    this.durationInSeconds = 2 * (this.renewalInterval / 1000);
    this.logAtLevel = options.logAtLevel ?? 'log';

    process.on('SIGINT', () => this.gracefulShutdown());
    process.on('SIGTERM', () => this.gracefulShutdown());
  }

  async onApplicationBootstrap() {
    if (!process.env.KUBERNETES_SERVICE_HOST) {
      this.logger[this.logAtLevel]('Not running in Kubernetes, assuming leadership...');
      this.isLeader = true;
      this.emitLeaderElectedEvent();
    } else {
      await this.tryToBecomeLeader();
      this.watchLeaseObject();
    }
  }

  private async tryToBecomeLeader() {
    try {
      let lease: V1Lease = await this.getLease();
      if (this.isLeaseExpired(lease) || !lease.spec.holderIdentity) {
        this.logger[this.logAtLevel]('Lease expired or not held. Attempting to become leader...');
        lease = await this.createLease();
      }
      if (this.isLeaseHeldByUs(lease)) {
        this.becomeLeader();
      }
    } catch (error) {
      this.logger.error('Error while trying to become leader', error);
    }
  }

  private async renewLease() {
    try {
      let lease: V1Lease = await this.getLease();
      if (this.isLeaseHeldByUs(lease)) {
        this.logger[this.logAtLevel]('Renewing lease...');
        await this.updateLease(lease);
      } else {
        this.loseLeadership();
      }
    } catch (error) {
      this.logger.error('Error while renewing lease', error);
      this.loseLeadership();
    }
  }

  private async getLease(): Promise<V1Lease> {
    try {
      const { body } = await this.kubeClient.readNamespacedLease(this.leaseName, this.namespace);
      return body;
    } catch (error) {
      if (error.response && error.response.statusCode === 404) {
        this.logger[this.logAtLevel]("Lease not found. Creating lease...");
        return this.createLease();
      } else {
        throw error;
      }
    }
  }

  private async createLease(): Promise<V1Lease> {
    const lease = {
      metadata: {
        name: this.leaseName,
        namespace: this.namespace,
      },
      spec: {
        holderIdentity: `nestjs-${process.env.HOSTNAME}`,
        leaseDurationSeconds: this.durationInSeconds,
        acquireTime:  new V1MicroTime(new Date()),
        renewTime: new V1MicroTime(new Date()),
      },
    };

    try {
      const { body } = await this.kubeClient.createNamespacedLease(this.namespace, lease);
      this.logger[this.logAtLevel]('Successfully created lease');
      return body;
    } catch (error) {
      this.logger.error('Failed to create lease', error);
      throw error;
    }
  }

  private async updateLease(lease: V1Lease): Promise<V1Lease> {
    lease.spec.renewTime = new V1MicroTime(new Date());
    try {
      const { body } = await this.kubeClient.replaceNamespacedLease(
        this.leaseName,
        this.namespace,
        lease
      );
      return body;
    } catch (error) {
      this.logger.error("Error while updating lease", error);
      throw error;
    }
  }

  
  private isLeaseExpired(lease: V1Lease): boolean {
    const renewTime = lease.spec.renewTime ? new Date(lease.spec.renewTime).getTime() : 0;
    const leaseDurationMs = (lease.spec.leaseDurationSeconds || this.durationInSeconds) * 1000;
    return Date.now() > renewTime + leaseDurationMs;
  }


  private isLeaseHeldByUs(lease: V1Lease): boolean {
    return lease.spec.holderIdentity === `nestjs-${process.env.HOSTNAME}`;
  }

  private async gracefulShutdown() {
    this.logger[this.logAtLevel]('Graceful shutdown initiated');
    if (this.isLeader) {
      await this.releaseLease();
    }
  }

  private async releaseLease(): Promise<void> {
    try {
      let lease = await this.getLease();
      if (lease && this.isLeaseHeldByUs(lease)) {
        lease.spec.holderIdentity = null;
        lease.spec.renewTime = null;
        await this.kubeClient.replaceNamespacedLease(this.leaseName, this.namespace, lease);
        this.logger[this.logAtLevel](`Lease for ${this.leaseName} released.`);
      }
    } catch (error) {
      this.logger.error('Failed to release lease', error);
    }
  }

  private emitLeaderElectedEvent() {
    this.eventEmitter.emit(LeaderElectedEvent, { leaseName: this.leaseName });
    this.logger[this.logAtLevel](`Instance became the leader for lease: ${this.leaseName}`);
  }

  private emitLeadershipLostEvent() {
    this.eventEmitter.emit(LeaderLostEvent, { leaseName: this.leaseName });
    this.logger[this.logAtLevel](`Instance lost the leadership for lease: ${this.leaseName}`);
  }

  private becomeLeader() {
    this.isLeader = true;
    this.emitLeaderElectedEvent();
    this.scheduleLeaseRenewal();
  }

  private loseLeadership() {
    if (this.isLeader) {
      this.isLeader = false;
      if (this.leaseRenewalTimeout) {
        clearTimeout(this.leaseRenewalTimeout);
        this.leaseRenewalTimeout = null;
      }
      this.emitLeadershipLostEvent();
    }
  }

  private async watchLeaseObject() {
    const path = `/apis/coordination.k8s.io/v1/namespaces/${this.namespace}/leases`;
    try {
      await this.watch.watch(
        path,
        {},
        (type, apiObj, watchObj) => {
          if (apiObj && apiObj.metadata.name === this.leaseName) {
            this.logger[this.logAtLevel](`Watch event type: ${type} for lease: ${this.leaseName}`);
            switch (type) {
              case 'ADDED':
              case 'MODIFIED':
                this.handleLeaseUpdate(apiObj);
                break;
              case 'DELETED':
                this.handleLeaseDeletion();
                break;
            }
          }
        },
        (err) => {
          if (err) {
            this.logger.error(`Watch for lease ended with error: ${err}, trying again in 5 seconds`);
            // Restart the watch after a delay
            setTimeout(() => this.watchLeaseObject(), 5000);
          } else {
            this.logger[this.logAtLevel]('Watch for lease gracefully closed');
          }
        }
      );
    } catch (err) {
      this.logger.error(`Failed to start watch for lease: ${err}, trying again in 5 seconds`);
      // Retry starting the watch after a delay
      setTimeout(() => this.watchLeaseObject(), 5000);
    }
  }

  private scheduleLeaseRenewal() {
    // Clear any existing lease renewal timeout.
    if (this.leaseRenewalTimeout) {
      clearTimeout(this.leaseRenewalTimeout);
    }
  
    // Schedule the lease renewal to happen at the renewalInterval.
    // The renewal should occur before the lease duration expires.
    this.leaseRenewalTimeout = setTimeout(async () => {
      if (this.isLeader) {
        try {
          await this.renewLease();
        } catch (error) {
          this.logger.error('Error while renewing lease', error);
          // If lease renewal fails, consider handling it by attempting to re-acquire leadership or similar.
        }
      }
    }, this.renewalInterval);
  }
  

  private handleLeaseUpdate(leaseObj: V1Lease) {
    if (this.isLeaseHeldByUs(leaseObj)) {
      if (!this.isLeader) {
        this.becomeLeader();
      }
      this.scheduleLeaseRenewal();
    } else if (this.isLeader) {
      this.loseLeadership();
    }
  }

  private handleLeaseDeletion() {
    if (!this.isLeader) {
      this.tryToBecomeLeader().catch((error) => {
        this.logger.error('Error while trying to become leader after lease deletion', error);
      });
    }
  }
}
