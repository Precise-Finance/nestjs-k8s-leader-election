
# NestJS Kubernetes Leader Election

This NestJS module implements leader election for applications running on Kubernetes. It allows you to ensure that a particular task is only being performed by one pod at a time in a cluster.

## Installation

```bash
npm install nestjs-k8s-leader-election
```

or with Yarn:

```bash
yarn add nestjs-k8s-leader-election
```

## Usage

First, import the `LeaderElectionModule` into the root `AppModule`:

```typescript
import { LeaderElectionModule } from 'nestjs-k8s-leader-election';

@Module({
  imports: [
    LeaderElectionModule.forRoot({
      leaseName: 'nestjs-leader-election',
      namespace: 'default',
      renewalInterval: 10000,
    }),
    // ... other modules
  ],
  // ... controllers, providers
})
export class AppModule {}
```

Or with asynchronous configuration:

```typescript
import { LeaderElectionModule } from 'nestjs-k8s-leader-election';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    LeaderElectionModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        leaseName: configService.get<string>('LEASE_NAME', 'nestjs-leader-election'),
        namespace: configService.get<string>('LEASE_NAMESPACE', 'default'),
        renewalInterval: configService.get<number>('LEASE_RENEWAL_INTERVAL', 10000),
      }),
    }),
    // ... other modules
  ],
  // ... controllers, providers
})
export class AppModule {}
```

## Handling Events

To react to leadership changes, use the `@OnEvent` decorator within your services:

```typescript
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { LeaderElectedEvent, LeaderLostEvent } from 'nestjs-k8s-leader-election';

@Injectable()
export class TaskService {
  
  @OnEvent(LeaderElectedEvent.event)
  onLeaderElected(event: LeaderElectedEvent) {
    // Logic to execute when this instance becomes the leader
  }

  @OnEvent(LeaderLostEvent.event)
  onLeaderLost(event: LeaderLostEvent) {
    // Logic to execute when this instance loses leadership
  }
}
```

This allows your application to only run certain tasks on the leader instance.

## Configuration

The module can be configured with the following options:

- `leaseName`: The name of the lease to create and watch in Kubernetes.
- `namespace`: The Kubernetes namespace in which the lease should be created.
- `renewalInterval`: The time in milliseconds between attempts to acquire or renew the lease.

The default values are as follows:

- `leaseName`: 'nestjs-leader-election'
- `namespace`: 'default'
- `renewalInterval`: 10000

## Kubernetes RBAC Configuration

To interact with the Kubernetes API, specifically to manage leases, your pods must be associated with a ServiceAccount that has the necessary permissions. Below is a sample RBAC configuration that grants the required access:

1. Create a `ServiceAccount` for your application:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: your-app-service-account
  namespace: default
```

2. Create a `Role` that grants permissions to manage leases:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: default
  name: lease-manager-role
rules:
- apiGroups: ["coordination.k8s.io"]
  resources: ["leases"]
  verbs: ["get", "list", "create", "update", "patch", "delete"]
```

3. Bind the `Role` to your `ServiceAccount` using a `RoleBinding`:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: lease-manager-rolebinding
  namespace: default
subjects:
- kind: ServiceAccount
  name: your-app-service-account
  namespace: default
roleRef:
  kind: Role
  name: lease-manager-role
  apiGroup: rbac.authorization.k8s.io
```

When you set up your application's `Deployment`, make sure to specify the `serviceAccountName`:

```yaml
spec:
  template:
    spec:
      serviceAccountName: your-app-service-account
      containers:
      - name: your-app
        image: your-image
        # ... other container configurations
```

This configuration will ensure that the pods running your application have the necessary permissions to perform leader election operations.

Make sure to replace `your-app-service-account`, `lease-manager-role`, and other placeholders with the appropriate names for your application and namespace.
```

In your deployment specifications, you would then reference the created `ServiceAccount` to ensure your pods are running with the correct permissions. This is an important step to make the leader election process work within Kubernetes as it relies on specific API access to create and manage leases.

## Contributing

Contributions are welcome! Please feel free to submit a pull request.

## Sponsor

This project is sponsored and developed by Precise Finance, [precisefinance.ai](https://precisefinance.ai).

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
```