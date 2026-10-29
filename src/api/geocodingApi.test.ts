import { describe, expect, it } from "vitest";
import { isValidGeographicCoordinate, parsePlaceResults, validatePlaceQuery } from "./geocodingApi";

describe("place search validation", () => {
  it("requires a trimmed query of 3 to 200 characters", () => {
    expect(validatePlaceQuery("  ")).toContain("3 characters");
    expect(validatePlaceQuery("ab")).toContain("3 characters");
    expect(validatePlaceQuery("abc")).toBeNull();
    expect(validatePlaceQuery("x".repeat(201))).toContain("200 characters");
  });
  it("accepts only finite longitude/latitude values in geographic ranges", () => {
    expect(isValidGeographicCoordinate([180, 90])).toBe(true);
    expect(isValidGeographicCoordinate([181, 0])).toBe(false);
    expect(isValidGeographicCoordinate([0, -91])).toBe(false);
    expect(isValidGeographicCoordinate([NaN, 0])).toBe(false);
    expect(isValidGeographicCoordinate([0])).toBe(false);
  });
  it("drops invalid coordinates and rejects malformed envelopes", () => {
    expect(parsePlaceResults({ results: [{ id: "1", displayName: "Bali", coordinate: [115, -8] }, { id: "2", displayName: "Bad", coordinate: [999, 0] }] })).toHaveLength(1);
    expect(() => parsePlaceResults({ items: [] })).toThrow("invalid response");
  });
});
