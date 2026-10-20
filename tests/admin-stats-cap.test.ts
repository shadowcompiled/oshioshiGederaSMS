import { describe, it, expect } from "vitest";
import { signupAxisCap } from "@/app/admin/AdminStats";

describe("signupAxisCap", () => {
  it("caps the axis a little above the second-busiest day when one day dwarfs the rest", () => {
    // The case from the admin page: ordinary days of 1-13 and one import day of 103.
    const cap = signupAxisCap([1, 2, 10, 13, 103, 4]);
    expect(cap).toBe(20); // 13 * 1.4 = 18.2 -> next step of 5
    expect(cap!).toBeLessThan(103);
    expect(cap!).toBeGreaterThan(13);
  });

  it("leaves an ordinary spread alone", () => {
    expect(signupAxisCap([3, 5, 8, 12, 9])).toBeNull();
  });

  it("needs at least three days, and a non-empty second day", () => {
    expect(signupAxisCap([2, 103])).toBeNull();
    expect(signupAxisCap([0, 0, 103])).toBeNull();
  });

  it("rounds to a readable tick step", () => {
    expect(signupAxisCap([1, 2, 3, 40])).toBe(6); // 4.2 -> step 2
    expect(signupAxisCap([10, 30, 400])).toBe(45); // 42 -> step 5
    expect(signupAxisCap([10, 60, 900])).toBe(90); // 84 -> step 10
  });
});
