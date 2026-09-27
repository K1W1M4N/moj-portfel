// src/inflationData.js
// Historia inflacji GUS (YoY, miesięczna) używana do wyliczania stawek obligacji
// indeksowanych inflacją: COI, EDO, ROS, ROD
//
// Format: "YYYY-MM": wartość jako ułamek dziesiętny (np. 0.047 = 4.7%)
// Źródło: GUS - miesięczne wskaźniki cen towarów i usług konsumpcyjnych od 1982 roku,
// "analogiczny miesiąc poprzedniego roku = 100" (np. 102,9 -> 0.029)
// Aktualizowana automatycznie przez GitHub Actions (.github/workflows/update-inflation.yml,
// scripts/fetch_inflation.py) — skrypt nadpisuje cały blok INFLATION_HISTORY
// Ostatnia aktualizacja: 2026-08

export const INFLATION_HISTORY = {
  "2015-01":-0.0140,"2015-02":-0.0160,"2015-03":-0.0150,"2015-04":-0.0110,
  "2015-05":-0.0090,"2015-06":-0.0080,"2015-07":-0.0070,"2015-08":-0.0060,
  "2015-09":-0.0080,"2015-10":-0.0070,"2015-11":-0.0060,"2015-12":-0.0050,
  "2016-01":-0.0090,"2016-02":-0.0080,"2016-03":-0.0090,"2016-04":-0.0110,
  "2016-05":-0.0090,"2016-06":-0.0080,"2016-07":-0.0090,"2016-08":-0.0080,
  "2016-09":-0.0050,"2016-10":-0.0020,"2016-11":0.0000,"2016-12":0.0080,
  "2017-01":0.0170,"2017-02":0.0220,"2017-03":0.0200,"2017-04":0.0200,
  "2017-05":0.0190,"2017-06":0.0150,"2017-07":0.0170,"2017-08":0.0180,
  "2017-09":0.0220,"2017-10":0.0210,"2017-11":0.0250,"2017-12":0.0210,
  "2018-01":0.0190,"2018-02":0.0140,"2018-03":0.0130,"2018-04":0.0160,
  "2018-05":0.0170,"2018-06":0.0200,"2018-07":0.0200,"2018-08":0.0200,
  "2018-09":0.0190,"2018-10":0.0180,"2018-11":0.0130,"2018-12":0.0110,
  "2019-01":0.0070,"2019-02":0.0120,"2019-03":0.0170,"2019-04":0.0220,
  "2019-05":0.0240,"2019-06":0.0260,"2019-07":0.0290,"2019-08":0.0290,
  "2019-09":0.0260,"2019-10":0.0250,"2019-11":0.0260,"2019-12":0.0340,
  "2020-01":0.0430,"2020-02":0.0470,"2020-03":0.0460,"2020-04":0.0340,
  "2020-05":0.0290,"2020-06":0.0330,"2020-07":0.0300,"2020-08":0.0290,
  "2020-09":0.0320,"2020-10":0.0310,"2020-11":0.0300,"2020-12":0.0240,
  "2021-01":0.0260,"2021-02":0.0240,"2021-03":0.0320,"2021-04":0.0430,
  "2021-05":0.0470,"2021-06":0.0440,"2021-07":0.0500,"2021-08":0.0550,
  "2021-09":0.0590,"2021-10":0.0680,"2021-11":0.0780,"2021-12":0.0860,
  "2022-01":0.0940,"2022-02":0.0850,"2022-03":0.1100,"2022-04":0.1240,
  "2022-05":0.1390,"2022-06":0.1550,"2022-07":0.1560,"2022-08":0.1610,
  "2022-09":0.1720,"2022-10":0.1790,"2022-11":0.1750,"2022-12":0.1660,
  "2023-01":0.1660,"2023-02":0.1840,"2023-03":0.1610,"2023-04":0.1470,
  "2023-05":0.1300,"2023-06":0.1150,"2023-07":0.1080,"2023-08":0.1010,
  "2023-09":0.0820,"2023-10":0.0660,"2023-11":0.0660,"2023-12":0.0620,
  "2024-01":0.0370,"2024-02":0.0280,"2024-03":0.0200,"2024-04":0.0240,
  "2024-05":0.0250,"2024-06":0.0260,"2024-07":0.0420,"2024-08":0.0430,
  "2024-09":0.0490,"2024-10":0.0500,"2024-11":0.0470,"2024-12":0.0470,
  "2025-01":0.0490,"2025-02":0.0490,"2025-03":0.0490,"2025-04":0.0430,
  "2025-05":0.0400,"2025-06":0.0410,"2025-07":0.0310,"2025-08":0.0290,
  "2025-09":0.0290,"2025-10":0.0280,"2025-11":0.0250,"2025-12":0.0240,
  "2026-01":0.0210,"2026-02":0.0210,"2026-03":0.0300,"2026-04":0.0320,
  "2026-05":0.0310,"2026-06":0.0250,"2026-07":0.0300,"2026-08":0.0340,
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

// Pobierz inflację dla danego okresu odsetkowego (COI, EDO, ROS, ROD)
//
// Listy emisyjne: stopa inflacji r/r "ogłaszana przez Prezesa GUS w miesiącu
// poprzedzającym pierwszy miesiąc danego okresu odsetkowego". W tym miesiącu GUS
// ogłasza wskaźnik za miesiąc o dwa wcześniejszy od startu okresu.
// Dla okresu zaczynającego się w sierpniu 2025 → komunikat z lipca → inflacja za czerwiec 2025.
//
// WERYFIKACJA (EDO zakup 30.08.2024, rok 2 od 30.08.2025):
// bank podaje 6.10% = marża 2% + inflacja 4.1% = GUS za czerwiec 2025 ("2025-06").
// Za sierpień 2025 GUS podał 2.9%, więc miesiąc startu okresu dałby złą stawkę.
//
// Okresy, dla których GUS jeszcze nie opublikował inflacji (przyszłe lata), liczone są
// z założenia getAssumedFutureInflation(). Po każdej miesięcznej aktualizacji danych
// kolejne okresy same przechodzą z założenia na prawdziwą wartość z GUS.
export function getInflationForBondPeriod(periodStartDate) {
  return getBondPeriodInflation(periodStartDate).value;
}

// To samo co getInflationForBondPeriod, plus informacja, czy wartość jest znana z GUS
// (assumed: false), czy jest założeniem dla przyszłego okresu (assumed: true)
export function getBondPeriodInflation(periodStartDate) {
  const d = new Date(periodStartDate);
  d.setDate(1);
  d.setMonth(d.getMonth() - 2);
  const yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  if (yearMonth > getLatestInflationMonth()) {
    return { value: getAssumedFutureInflation(), assumed: true, yearMonth };
  }
  return { value: getInflationForMonth(yearMonth), assumed: false, yearMonth };
}

export function getLatestInflationMonth() {
  return Object.keys(INFLATION_HISTORY).sort().pop();
}

// Założenie inflacji dla przyszłych okresów: średnia z ostatnich 12 opublikowanych miesięcy.
// Nie skacze od jednego odczytu jak "ostatni miesiąc" i nie jest wzięta z sufitu jak stałe 4%.
// Zaokrąglona do 0,1 p.p., tak jak GUS publikuje inflację — w wyliczeniach i w etykietach
// używana jest ta sama liczba.
export const ASSUMED_INFLATION_MONTHS = 12;
export function getAssumedFutureInflation() {
  const values = Object.keys(INFLATION_HISTORY).sort()
    .slice(-ASSUMED_INFLATION_MONTHS)
    .map(k => INFLATION_HISTORY[k]);
  if (!values.length) return 0.04;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  // epsilon: suma ułamków binarnych daje np. 0.027499999… zamiast 0.0275
  return Math.round(avg * 1000 + 1e-9) / 1000;
}
