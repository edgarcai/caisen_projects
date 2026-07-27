import { describe, expect, it } from "vitest";
import { buildH5Harness, requirePlayer, requireState } from "../helpers/H5TestHarness";

describe("跨城侦察应用闭环", () => {
  it("远城在侦察前锁定，满一周后可进入并建立分避难所", () => {
    const { application } = buildH5Harness();
    application.startNewGame(["新城观测员"], "single");
    const state = requireState(application);
    const remoteCityId = "city_c";

    const locked = application.expeditionCities().find(
      (city) => city.city.id === remoteCityId,
    );
    expect(locked).toMatchObject({ accessible: false, relation: "remote" });
    expect(locked?.reason).toContain("侦察一周");

    state.shelter.newspapers = 20;
    state.inventory.crafted_items.armored_car = 1;
    state.inventory.equipped_transport_ids = ["armored_car"];
    expect(application.startCityRecon(remoteCityId, "haocai").stateChanged).toBe(true);
    expect(application.cityReconMissions()[0]).toMatchObject({
      cityId: remoteCityId,
      companionId: "haocai",
      daysRemaining: 7,
    });
    expect(application.expeditionCompanions().some(
      (companion) => companion.companionId === "haocai",
    )).toBe(false);

    state.survival_days += 7;
    const completed = application.completeCityRecon(remoteCityId);
    expect(completed.stateChanged).toBe(true);
    expect(completed.messages.join("\n")).toContain("C市");
    expect(application.expeditionCities().find(
      (city) => city.city.id === remoteCityId,
    )?.accessible).toBe(true);
    expect(application.expeditionCompanions().some(
      (companion) => companion.companionId === "haocai",
    )).toBe(true);

    const currentPlayer = requirePlayer(requireState(application));
    currentPlayer.coins = 300;
    currentPlayer.parts = 300;
    const established = application.establishOutpost(
      remoteCityId,
      "city_c_district_a",
      "air_raid_bunker",
    );
    expect(established.stateChanged).toBe(true);
    expect(application.outposts()[0]).toMatchObject({
      cityId: remoteCityId,
      districtId: "city_c_district_a",
      shelterTypeId: "air_raid_bunker",
    });
    const outpostId = application.outposts()[0]?.outpostId;
    if (outpostId === undefined) throw new Error("测试需要已建立分避难所。");
    expect(application.assignCompanionToOutpost(outpostId, "haocai").stateChanged).toBe(true);
    expect(application.expeditionCompanions().some(
      (companion) => companion.companionId === "haocai",
    )).toBe(false);
  });
});
