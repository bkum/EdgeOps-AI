import { describe, expect, it } from "vitest";
import { detect, validateFinding, questionSchema } from "../src/domain";
import { samplesFor } from "../src/fixtures";
import { callSchema } from "../src/chat";

describe("deterministic detection", () => {
  it("requires minimum samples and two failures", () => {
    expect(detect(samplesFor("deployment-regression"))).toBe("unhealthy");
    expect(detect(samplesFor("healthy"))).toBe("healthy");
    expect(detect(samplesFor("insufficient-data"))).toBe("unknown");
    expect(detect([])).toBe("unknown");
    const samples = samplesFor("deployment-regression");
    samples[1].status = "unknown";
    expect(detect(samples)).toBe("unknown");
  });
  it("does not let an unknown sample satisfy a minimum", () => {
    const samples = samplesFor("deployment-regression");
    samples[0].status = "unknown";
    expect(detect(samples)).toBe("unknown");
  });
});
describe("bounded output and tools", () => {
  const finding = {
    summary: "Unconfirmed regression",
    observations: [{ text: "Failed probe", evidenceIds: ["allowed"] }],
    hypotheses: [],
    recommendations: ["Check revision"],
    unknowns: ["Cause unconfirmed"],
  };
  it("requires run-local citations and explicit unknowns", () => {
    expect(validateFinding(finding, ["allowed"]).summary).toBe(
      "Unconfirmed regression",
    );
    expect(() => validateFinding(finding, ["other-scope"])).toThrow();
    expect(() =>
      validateFinding({ ...finding, unknowns: [] }, ["allowed"]),
    ).toThrow();
    expect(() =>
      validateFinding({ ...finding, tools: ["fetch"] }, ["allowed"]),
    ).toThrow();
  });
  it("accepts free text as data but rejects extra privileges and arbitrary tool execution", () => {
    expect(
      questionSchema.safeParse({ question: "Why is the API slow?" }).success,
    ).toBe(true);
    expect(
      callSchema.safeParse({
        name: "fetch",
        arguments: { url: "http://127.0.0.1" },
      }).success,
    ).toBe(false);
    expect(
      callSchema.safeParse({
        name: "getIncidentHistory",
        arguments: { scope: "live" },
      }).success,
    ).toBe(false);
    for (const input of [
      { question: "" },
      { question: "x".repeat(1001) },
      { question: "service-health", scope: "live" },
      { question: "service-health", token: "canary-secret" },
    ]) {
      expect(questionSchema.safeParse(input).success).toBe(false);
    }
  });
});
