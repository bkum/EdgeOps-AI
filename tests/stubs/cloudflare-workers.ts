// Test-only stand-in for the Workers runtime module, so Workflow classes can be driven
// directly with a fake step runner. Not used by the Worker build.
export class WorkflowEntrypoint<Env = unknown> {
  constructor(
    readonly ctx: unknown,
    readonly env: Env,
  ) {}
}
export type WorkflowEvent<T> = { payload: T };
export type WorkflowStep = {
  do<T>(name: string, config: unknown, fn: () => Promise<T>): Promise<T>;
};
