import regression from "../fixtures/demo-scenarios/deployment-regression.json";
import { sampleSchema, type Scenario, type Sample } from "./domain";

export function samplesFor(scenario: Scenario): Sample[] {
  const samples = regression.samples.map((s) => sampleSchema.parse(s));
  if (scenario === "healthy")
    return samples.map((s) => ({ ...s, status: "healthy", latencyMs: 90 }));
  if (scenario === "database-slowdown")
    return samples.map((s) => ({
      ...s,
      latencyMs: s.status === "healthy" ? 120 : 3100,
    }));
  if (scenario === "recurring-api-failure")
    return samples.map((s) => ({
      ...s,
      latencyMs: s.status === "healthy" ? 70 : 5000,
    }));
  if (scenario === "insufficient-data") return samples.slice(0, 1);
  return samples;
}
