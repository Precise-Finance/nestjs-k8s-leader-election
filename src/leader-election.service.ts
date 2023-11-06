import {
  Global,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from "@nestjs/common";
import {
  KubeConfig,
  CoordinationV1Api,
  V1Lease,
  V1MicroTime,
} from "@kubernetes/client-node";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { LeaderElectedEvent, LeaderElectionOptions, LeaderLostEvent } from "./leader-election-options.interface";

@Injectable()
export class LeaderElectionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(LeaderElectionService.name);
  private kubeClient: CoordinationV1Api;
  private leaseName: string;
  private namespace: string;
  private renewalInterval: number;
  private isLeader = false;
  private wasLeader = false;


  constructor(
    @Inject("LEADER_ELECTION_OPTIONS") private options: LeaderElectionOptions,
    private readonly eventEmitter: EventEmitter2
  ) {
    const kubeConfig = new KubeConfig();
    kubeConfig.loadFromDefault();
    this.kubeClient = kubeConfig.makeApiClient(CoordinationV1Api);

    this.leaseName = options.leaseName ?? "nestjs-leader-election";
    this.namespace = options.namespace ?? "default";
    this.renewalInterval = options.renewalInterval ?? 10000;

    process.on("SIGINT", () => this.gracefulShutdown());
    process.on("SIGTERM", () => this.gracefulShutdown());
  }

  async onApplicationBootstrap() {
    // If specific Kubernetes environment variables are not set, assume not running in k8s
    if (!process.env.KUBERNETES_SERVICE_HOST) {
      this.logger.log('Not running in Kubernetes, assuming leadership...');
      this.isLeader = true;
      this.emitLeaderElectedEvent();
    } else {
      await this.electionLoop();
    }
  }

  private async gracefulShutdown() {
    await this.releaseLease();
  }

  private async electionLoop() {
    try {
      if (this.isLeader) {
        await this.renewLease();
      } else {
        await this.tryToBecomeLeader();
      }
    } catch (error) {
      this.logger.error("Error in leader election loop", error);
      this.isLeader = false; // Ensuring we don't falsely assume leadership
    }
    setTimeout(() => this.electionLoop(), this.renewalInterval);
  }

  private async tryToBecomeLeader() {
    try {
      let lease: V1Lease = await this.getLease();

      if (this.isLeaseExpired(lease)) {
        this.logger.log('Lease expired. Attempting to become leader...');
        lease = await this.updateLease(lease);
      }

      const isCurrentlyLeader = this.isLeaseHeldByUs(lease);

      // Emit event only if the instance just became the leader
      if (isCurrentlyLeader && !this.wasLeader) {
        this.emitLeaderElectedEvent();
      }

      // Update the current and past leader status
      this.wasLeader = this.isLeader = isCurrentlyLeader;

      this.logLeadershipStatus();
    } catch (error) {
      this.logger.error('Error while trying to become leader', error);
    }
  }

  private async renewLease() {
    try {
      const lease = await this.getLease();
      if (this.isLeaseHeldByUs(lease)) {
        this.logger.log('Renewing lease...');
        await this.updateLease(lease);

        // We are already the leader, so no event emission here
        // However, we do need to keep the wasLeader status updated
        this.wasLeader = this.isLeader = true;
      } else {
        // Handle potential leadership loss
        if (this.wasLeader) {
          // If we were the leader but lost it, we emit an event or perform an action
          this.emitLeadershipLostEvent(); // You would need to implement this method
        }
        this.isLeader = this.wasLeader = false;
        this.logLeadershipStatus();
      }
    } catch (error) {
      this.logger.error('Error while renewing lease', error);
      this.isLeader = this.wasLeader = false;
    }
  }

  private async getLease(): Promise<V1Lease> {
    try {
      const { body } = await this.kubeClient.readNamespacedLease(
        this.leaseName,
        this.namespace
      );
      return body;
    } catch (error) {
      if (error.response && error.response.statusCode === 404) {
        this.logger.log("Lease not found. Creating lease...");
        return this.createLease();
      } else {
        throw error;
      }
    }
  }

  private async createLease(): Promise<V1Lease> {
    const lease = new V1Lease();
    lease.metadata = { name: this.leaseName, namespace: this.namespace };
    lease.spec = {
      holderIdentity: `${this.leaseName}-${Date.now()}`,
      leaseDurationSeconds: 15,
      acquireTime: new V1MicroTime(),
      renewTime: new V1MicroTime(),
    };

    try {
      const { body } = await this.kubeClient.createNamespacedLease(
        this.namespace,
        lease
      );
      return body;
    } catch (error) {
      this.logger.error("Error while creating lease", error);
      throw error;
    }
  }

  private async updateLease(lease: V1Lease): Promise<V1Lease> {
    const podName = process.env.HOSTNAME; // Unique identifier for the pod.
    lease.spec.holderIdentity = `${this.leaseName}-${podName}`;
    lease.spec.renewTime = new V1MicroTime();

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
    if (!lease.spec.renewTime) {
      return true;
    }
    const renewTime = new Date(lease.spec.renewTime).getTime();
    const leaseDuration = (lease.spec.leaseDurationSeconds ?? 15) * 1000;
    return Date.now() - renewTime > leaseDuration;
  }

  private isLeaseHeldByUs(lease: V1Lease): boolean {
    const podName = process.env.HOSTNAME;
    return lease.spec.holderIdentity === `${this.leaseName}-${podName}`;
  }

  private logLeadershipStatus() {
    if (this.isLeader) {
      this.logger.log("This instance is the leader");
    } else {
      this.logger.log("This instance is not the leader");
    }
  }

  private async releaseLease(): Promise<void> {
    if (!this.isLeader) {
      // If we're not the leader, there's nothing to release.
      return;
    }

    try {
      // Set the lease's holderIdentity to null or to some specific "released" value.
      const lease: V1Lease = await this.getLease();
      lease.spec.holderIdentity = null;
      lease.spec.renewTime = null; // Clear renew time to indicate it's not being renewed.

      // Push the updated lease back to Kubernetes.
      await this.kubeClient.replaceNamespacedLease(
        this.leaseName,
        this.namespace,
        lease
      );

      this.logger.log(`Lease for ${this.leaseName} released.`);
    } catch (error) {
      this.logger.error("Error while releasing lease", error);
      // Depending on the requirements, you might throw the error, or handle it accordingly.
    } finally {
      this.isLeader = false;
    }
  }

  public IsLeader(): boolean {
    return this.isLeader;
  }

  private emitLeaderElectedEvent() {
    this.eventEmitter.emit(LeaderElectedEvent, { leaseName: this.leaseName });
    this.logger.log(`Instance became the leader for lease: ${this.leaseName}`);
  }

  private emitLeadershipLostEvent() {
    this.eventEmitter.emit(LeaderLostEvent, { leaseName: this.leaseName });
    this.logger.log(`Instance lost the leadership for lease: ${this.leaseName}`);
  }
}
