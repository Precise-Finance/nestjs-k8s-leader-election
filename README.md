# NestJS Kubernetes Leader Election

This NestJS module implements leader election for applications running on Kubernetes. It ensures that a particular task is only performed by one pod at a time in a cluster, which is crucial for high-availability and consistent operations.

## Installation

```bash
npm install nestjs-k8s-leader-election
```

or with Yarn:

```bash
yarn add nestjs-k8s-leader-election
```

## Usage

Import the `LeaderElectionModule` into the root `AppModule` and configure it:

```typescript
// ... other imports ...
import { LeaderElectionModule } from 'nestjs-k8s-leader-election';

@Module({
  imports: [
    LeaderElectionModule.forRoot({
      // ... configuration options ...
    }),
    // ... other modules
  ],
  // ... controllers, providers
})
export class AppModule {}
```

## Advanced Usage with Watch Feature

The service utilizes the Kubernetes watch feature to monitor lease objects for changes. This is particularly beneficial for systems that require immediate response to leadership changes and can greatly improve the reliability and fault tolerance of distributed systems.

When a lease is modified or deleted, the service responds in real-time, allowing for quick failover and ensuring that only one instance of the application assumes leadership at any given time. This makes the system well-suited for handling scale and high load, as leadership transitions are smooth and immediate.

## Handling Events

The module emits events when leadership is acquired or lost. Use the `@OnEvent` decorator to handle these events:

```typescript
// ... other imports ...
import { OnEvent } from '@nestjs/event-emitter';
import { LeaderElectedEvent, LeaderLostEvent } from 'nestjs-k8s-leader-election';

@Injectable()
export class TaskService {
  @OnEvent(LeaderElectedEvent)
  handleLeaderElected(event: { leaseName: string }) {
    // Logic when becoming the leader
  }

  @OnEvent(LeaderLostEvent)
  handleLeaderLost(event: leaseName: string) {
    // Logic when losing leadership
  }
}
```

## Configuration Options

- `leaseName`: Name of the lease resource.
- `namespace`: Kubernetes namespace for the lease.
- `renewalInterval`: Interval to attempt lease renewal (in milliseconds).

## Kubernetes RBAC Configuration

To allow your application to manage leases, set up the appropriate RBAC configuration in Kubernetes. This involves creating a `ServiceAccount`, `Role`, and `RoleBinding` to grant the necessary permissions.

```yaml
# ServiceAccount
apiVersion: v1
kind: ServiceAccount
metadata:
  name: your-service-account
  namespace: default

# Role
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: default
  name: lease-manager-role
rules:
- apiGroups: ["coordination.k8s.io"]
  resources: ["leases"]
  verbs: ["get", "watch", "list", "create", "update", "delete"]

# RoleBinding
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: lease-manager-rolebinding
  namespace: default
subjects:
- kind: ServiceAccount
  name: your-service-account
  namespace: default
roleRef:
  kind: Role
  name: lease-manager-role
  apiGroup: rbac.authorization.k8s.io
```

Then, reference the `ServiceAccount` in your pod's deployment configuration:

```yaml
spec:
  template:
    spec:
      serviceAccountName: your-service-account
      # ... other specs ...
```

## Contributing

Contributions to improve the module are welcome. Please submit your pull requests or issues as needed.

## Sponsor

This project is sponsored and developed by Precise Finance, [precisefinance.ai](https://precisefinance.ai).


## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
```