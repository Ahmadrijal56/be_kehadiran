import { describe, expect, it } from "vitest";
import {
  compareTodayLeaderboard,
  sortAndRankTodayLeaderboard,
} from "./publicRankingSort.js";

describe("publicRankingSort", () => {
  it("poin sama — absen paling awal di atas", () => {
    const rows = sortAndRankTodayLeaderboard([
      {
        rank: 1,
        nik: "1803",
        full_name: "Anggit",
        total_points: 2,
        today_points: 2,
        today_check_in: "06:52",
        today_status: "present",
      },
      {
        rank: 2,
        nik: "1806",
        full_name: "Savira",
        total_points: 2,
        today_points: 2,
        today_check_in: "06:51",
        today_status: "present",
      },
      {
        rank: 3,
        nik: "1807",
        full_name: "Vika",
        total_points: 1,
        today_points: 1,
        today_check_in: "06:56",
        today_status: "present",
      },
    ]);

    expect(rows[0]?.nik).toBe("1806");
    expect(rows[0]?.rank).toBe(1);
    expect(rows[1]?.nik).toBe("1803");
    expect(rows[2]?.nik).toBe("1807");
  });

  it("compareTodayLeaderboard — belum absen di bawah yang sudah masuk", () => {
    const checked = {
      rank: 0,
      nik: "1",
      full_name: "A",
      total_points: 0,
      today_points: 2 as number | null,
      today_check_in: "07:00",
      today_status: "present",
    };
    const absent = {
      rank: 0,
      nik: "2",
      full_name: "B",
      total_points: 0,
      today_points: null as number | null,
      today_check_in: null as string | null,
      today_status: "absent",
    };
    expect(compareTodayLeaderboard(checked, absent)).toBeLessThan(0);
  });
});
