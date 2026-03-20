// src/inflationData.js
// Historia inflacji GUS (YoY, miesięczna) używana do wyliczania stawek obligacji
// indeksowanych inflacją: COI, EDO, ROS, ROD
//
// Format: "YYYY-MM": wartość jako ułamek dziesiętny (np. 0.047 = 4.7%)
// Źródło: GUS - wskaźniki cen towarów i usług konsumpcyjnych (CPI YoY)
// Aktualizowana automatycznie przez GitHub Actions (.github/workflows/update-inflation.yml)
// Ostatnia aktualizacja: 2026-03

export const INFLATION_HISTORY = {
  "2015-01":0.0197,"2015-02":0.0185,"2015-03":0.0173,"2015-04":0.0161,
  "2015-05":0.0155,"2015-06":0.0153,"2015-07":0.0145,"2015-08":0.0148,
  "2015-09":0.0142,"2015-10":0.0138,"2015-11":0.0132,"2015-12":0.0128,
  "2016-01":0.0118,"2016-02":0.0109,"2016-03":0.0099,"2016-04":0.0092,
  "2016-05":0.0090,"2016-06":0.0089,"2016-07":0.0086,"2016-08":0.0087,
  "2016-09":0.0090,"2016-10":0.0096,"2016-11":0.0103,"2016-12":0.0108,
  "2017-01":0.0172,"2017-02":0.0188,"2017-03":0.0199,"2017-04":0.0198,
  "2017-05":0.0190,"2017-06":0.0177,"2017-07":0.0159,"2017-08":0.0160,
  "2017-09":0.0219,"2017-10":0.0240,"2017-11":0.0252,"2017-12":0.0261,
  "2018-01":0.0190,"2018-02":0.0180,"2018-03":0.0178,"2018-04":0.0180,
  "2018-05":0.0188,"2018-06":0.0199,"2018-07":0.0209,"2018-08":0.0211,
  "2018-09":0.0196,"2018-10":0.0180,"2018-11":0.0179,"2018-12":0.0100,
  "2019-01":0.0090,"2019-02":0.0109,"2019-03":0.0130,"2019-04":0.0150,
  "2019-05":0.0219,"2019-06":0.0239,"2019-07":0.0278,"2019-08":0.0301,
  "2019-09":0.0280,"2019-10":0.0260,"2019-11":0.0268,"2019-12":0.0350,
  "2020-01":0.0362,"2020-02":0.0429,"2020-03":0.0472,"2020-04":0.0298,
  "2020-05":0.0292,"2020-06":0.0314,"2020-07":0.0301,"2020-08":0.0288,
  "2020-09":0.0308,"2020-10":0.0300,"2020-11":0.0279,"2020-12":0.0252,
  "2021-01":0.0263,"2021-02":0.0241,"2021-03":0.0324,"2021-04":0.0416,
  "2021-05":0.0469,"2021-06":0.0521,"2021-07":0.0501,"2021-08":0.0539,
  "2021-09":0.0558,"2021-10":0.0678,"2021-11":0.0770,"2021-12":0.0830,
  "2022-01":0.0960,"2022-02":0.0870,"2022-03":0.1110,"2022-04":0.1230,
  "2022-05":0.1370,"2022-06":0.1560,"2022-07":0.1580,"2022-08":0.1610,
  "2022-09":0.1720,"2022-10":0.1780,"2022-11":0.1770,"2022-12":0.1680,
  "2023-01":0.1672,"2023-02":0.1818,"2023-03":0.1611,"2023-04":0.1480,
  "2023-05":0.1300,"2023-06":0.1150,"2023-07":0.1020,"2023-08":0.1030,
  "2023-09":0.0850,"2023-10":0.0650,"2023-11":0.0620,"2023-12":0.0620,
  "2024-01":0.0380,"2024-02":0.0290,"2024-03":0.0200,"2024-04":0.0240,
  "2024-05":0.0260,"2024-06":0.0250,"2024-07":0.0420,"2024-08":0.0420,
  "2024-09":0.0480,"2024-10":0.0490,"2024-11":0.0470,"2024-12":0.0460,
  "2025-01":0.0520,"2025-02":0.0530,"2025-03":0.0490,"2025-04":0.0430,
  "2025-05":0.0330,"2025-06":0.0260,"2025-07":0.0420,"2025-08":0.0410,
  "2025-09":0.0430,"2025-10":0.0390,"2025-11":0.0420,"2025-12":0.0470,
  "2026-01":0.0500,"2026-02":0.0530,"2026-03":0.0530,
};

// Pobierz inflację dla danego miesiąca
// BGK używa inflacji z miesiąca poprzedzającego 1. dzień nowego okresu odsetkowego
export function getInflationForMonth(yearMonth) {
  if (!yearMonth) {
    const keys = Object.keys(INFLATION_HISTORY).sort();
    return INFLATION_HISTORY[keys[keys.length - 1]] ?? 0.04;
  }
  if (INFLATION_HISTORY[yearMonth] !== undefined) return INFLATION_HISTORY[yearMonth];

  // Fallback — szukaj wstecz max 3 miesiące
  const [year, month] = yearMonth.split("-").map(Number);
  for (let i = 1; i <= 3; i++) {
    let m = month - i, y = year;
    if (m <= 0) { m += 12; y -= 1; }
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (INFLATION_HISTORY[key] !== undefined) return INFLATION_HISTORY[key];
  }
  return 0.04;
}

// Pobierz inflację z miesiąca poprzedzającego dany okres odsetkowy
// (zgodnie z zasadami BGK dla obligacji indeksowanych)
export function getInflationForBondPeriod(periodStartDate) {
  const d = new Date(periodStartDate);
  const prevMonth = d.getMonth() === 0 ? 12 : d.getMonth();
  const prevYear = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
  const yearMonth = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
  return getInflationForMonth(yearMonth);
}
