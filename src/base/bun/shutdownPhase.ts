export enum ShutdownPhase {
  Ingress = 0,
  Workers = 1,
  DataStores = 2,
  NativeRuntime = 3,
  Telemetry = 4,
}
