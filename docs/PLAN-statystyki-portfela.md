# Plan: statystyki ekranu głównego (v3 — ZATWIERDZONY do wdrożenia, nic jeszcze nie wdrożone)

## 1. Problem (stan obecny, `src/App.jsx` → `PortfolioSummaryPanel`)
- "Zysk dzienny/miesięczny/roczny" to estymacja: obligacje i konta liczone odsetkami wstecz,
  akcje/krypto/surowce/waluty zakładane jako bez zmian (diff = 0). Akcje to ~31% portfela.
- "Średnia roczna" = ta sama liczba co "zysk roczny".
- Wpłata/zakup nie jest odróżniona od zysku.
- Okna "30 dni" / "365 dni" zamiast "ten miesiąc" / "ten rok".

## 2. Docelowe kafelki
Zostaje: Bieżąca wartość.

| Kafelek | Definicja |
|---|---|
| Bilans dziś | zmiana od poprzedniego zamknięcia |
| Bilans w tym miesiącu | od ostatniego dnia poprzedniego miesiąca (MTD) |
| Bilans w tym roku | od 31 grudnia (YTD) |
| Bilans portfela | zysk całkowity = wartość − wpłacone (+ zrealizowane, patrz 5) |

## 3. Metoda liczenia: rekonstrukcja per pozycja (główna) + snapshoty (zapas)

Bilans okresu = suma po pozycjach: `wartość dziś − wartość bazowa`, gdzie wartość bazowa to:
- pozycja/transza kupiona PRZED początkiem okresu → ilość × faktyczny kurs zamknięcia z początku okresu × kurs waluty z tego dnia,
- pozycja/transza kupiona W TRAKCIE okresu → kwota zapłacona (więc zakup nie jest zyskiem).

Dzięki temu MTD/YTD działają od razu, bez czekania na zebranie snapshotów.

Dostępność danych per typ aktywa:
| Typ | Wartość na początek okresu | Data zakupu |
|---|---|---|
| Obligacje | dokładny wzór (`calcBondCurrentValue(bond, data)`) | jest (`purchaseDate`) |
| Konto oszczędnościowe | dokładnie z `computeSavings` (transakcje z datami, historia stawek) | jest |
| Akcje z importu XTB | kurs historyczny Yahoo (`api/_lib/stock-chart.js`, dodać zakres dzienny) | jest (`openTime` w transzach) |
| Akcje dodane ręcznie | kurs historyczny Yahoo | BRAK → patrz pytanie A |
| Krypto | CoinGecko history | BRAK |
| Surowce | Yahoo history | do sprawdzenia |
| Waluty / gotówka | kurs historyczny (NBP/Yahoo) | BRAK |
| Inne (ręczne) | brak źródła → bilans 0, oznaczone | — |

"Bilans dziś": akcje z `previousClose` (dodać do `api/_lib/stock-price.js`: Yahoo `meta.chartPreviousClose`),
krypto z `include_24hr_change` (już pobierane z CoinGecko, nieużywane), obligacje `dailyGain` (już liczone), konta: odsetki dzienne.

Snapshoty (`pt-history`) zostają jako zapas dla pozycji bez dat i jako dane do wykresu historii — po naprawie (pkt 4).

## 4. Błędy znalezione przy analizie (do naprawy niezależnie od kafelków)
1. `history` jest JEDNA dla wszystkich portfeli, a snapshot zapisuje wartość aktualnie otwartej zakładki
   (`App.jsx:1576-1581`). Otwarcie apki na zakładce TEST zapisuje do historii wartość TEST-u → wykres historii miesza portfele.
   Naprawa: snapshot per portfel (`totals: { [portfolioId]: {value, paid, byCategory} }`).
2. Snapshot robi się raz dziennie przy pierwszym renderze z total > 0 — zwykle na cenach z cache, przed pobraniem świeżych,
   i już się tego dnia nie aktualizuje. Naprawa: nadpisywać dzisiejszy wpis po odświeżeniu cen (ostatnia znana wartość dnia).
3. `getAssetCostBasis` (`App.jsx:320`) czyta `a.commodityPaid`, a pole nazywa się `commodityPaidPLN`
   → koszt surowców = ich wartość → zysk surowców w podsumowaniu zawsze 0.
4. Krypto/waluty: brak kosztu → zysk 0 (waluty: `return a.value`). Do decyzji, czy waluty mają mieć koszt zakupu.

## 5. Luka: sprzedane pozycje
Aplikacja zna tylko stan bieżący. Po sprzedaży pozycja znika razem ze swoim zyskiem — "Bilans portfela" i bilanse okresów
tracą zrealizowany wynik. Import XTB wykrywa zamknięte pozycje (`kind: "remove"`), a arkusz "Cash Operations" zawiera
realne przepływy (sprzedaże, dywidendy, wpłaty).
Propozycja: dziennik zrealizowanych wyników `pt-realized: [{date, portfolioId, category, symbol, pnlPLN, kind: "sale"|"dividend"|"interest"}]`,
doliczany do bilansów okresów i do "Bilansu portfela".

## 6. Pozostałe ustalenia
- Wszystko liczone w PLN — zmiana kursu walut jest częścią bilansu (bez rozdzielania na "kurs akcji" i "FX").
- Tryb P&L "XTB" (koszt po bieżącym kursie) dotyczy tylko "Bilansu portfela"; bilanse okresów liczone zawsze z faktycznych cen i kursów.
- Procent przy kafelku: bilans / (wartość bazowa + wpłaty w okresie).
- Filtr kategorii: metoda per pozycja daje to za darmo.
- Wypłacone odsetki od obligacji (COI/ROR/DOR wypłacają co rok/miesiąc) — sprawdzić, czy `calcBondCurrentValue` je wlicza do wartości.
- Podatek Belki: obligacje i akcje pokazywane brutto, konto oszczędnościowe netto — niespójność, do decyzji.

## 7. Decyzje (zatwierdzone przez użytkownika)
A. Opcjonalne pole "data zakupu" w formularzach akcji (tryby Szybko/Transze/Z brokera) i krypto. Każde nowe aktywo dostaje `createdAt`;
   pozycja bez daty zakupu liczona od `createdAt`, a istniejące bez obu pól — tylko ze snapshotów (kafelek z dopiskiem "od DD.MM").
B. Weekend/święto: "Bilans dziś" pokazuje wynik ostatniej sesji z dopiskiem dnia (np. "pt."); odsetki obligacji/kont liczone normalnie.
C. Dziennik zrealizowanych wyników — tak. Maksimum z importu XTB (użytkownik korzysta z XTB), ręczne dodawanie jako uzupełnienie.
D. Kolejność dowolna; proponowana w pkt 9.

## 7a. Ustalenia z kodu po decyzjach
- Obligacje kuponowe (`params.coupon` w `BondModal.jsx`): `calcSingleBond` po każdej rocznicy wraca do 100 zł → wypłacony kupon znika z wartości.
  W dniu wypłaty bilans pokazałby dużą stratę. Kupony da się wyliczyć deterministycznie (data rocznicy, 100 × stopa okresu × ilość)
  → doliczać je do zrealizowanych jako `kind: "coupon"` (wyliczane w locie, bez zapisu).
- Import XTB dziś czyta z "Cash Operations" tylko wiersze `Type = "Stock purchase"` (`xtbImport.js:87-107`).
  Do dziennika potrzebne: sprzedaże, dywidendy, podatek u źródła, odsetki od wolnych środków, ewentualnie arkusz "Closed Positions".
  DOKŁADNE NAZWY typów i kolumn trzeba sprawdzić na prawdziwym pliku eksportu — poprosić użytkownika o plik (nie zgadywać).
- Import ze zrzutu ekranu nie ma dat transz (`estimated: true`, brak `openTime`) → te pozycje jak ręczne bez daty.
- Dziennik musi być idempotentny: ponowny import tego samego pliku nie może dublować wpisów (klucz: konto + ID operacji z XTB).

## 9. Etapy wdrożenia
**Status: etap 1 zacommitowany (93436ae). Etap 2 zrobiony i sprawdzony w trybie testowym (niezacommitowany). Kolejny: etap 3.**
Etap 2 — logika w `src/dailyBalance.js`. Ograniczenia: kurs waluty z poprzedniego dnia przyjęty jako dzisiejszy (zmiana FX w ciągu doby
nie jest ujęta); waluty/gotówka i aktywa ręczne nie mają źródła zmiany dziennej → kafelek pokazuje dopisek "bez: <kategoria>";
krypto liczone ze zmiany 24h (okno kroczące, nie sesja).
Odstępstwo od planu w etapie 1: bez podbicia `SCHEMA_VERSION` — nowy `src/historyStore.js` czyta oba formaty historii (stary i nowy),
więc migracja nie jest potrzebna (stare wpisy są czytane jako portfel "default" z flagą `legacy`).
1. Naprawy: koszt surowców (`commodityPaidPLN` w `getAssetCostBasis`); snapshot per portfel + pole `paid` + nadpisywanie wpisu dnia po odświeżeniu cen;
   migracja starej `pt-history` (stare wpisy przypisać do portfela "default", oznaczyć jako niepewne); `SCHEMA_VERSION` → 3; `useCloudSync` nadal wysyła `history` pod tym samym kluczem.
2. "Bilans dziś": `previousClose` w `api/_lib/stock-price.js` + `useStockPrices`; krypto zmiana 24h; obligacje `dailyGain`; konta odsetki dzienne; dopisek dnia sesji.
3. Moduł `src/periodBalance.js` (czysta logika, bez Reacta): wartość bazowa per pozycja/transza, obsługa zakupu w trakcie okresu, procent.
   Kursy historyczne: rozszerzyć `api/_lib/stock-chart.js` o dzienny zakres YTD (lub nowy lekki endpoint "cena na dzień") + kurs waluty na dzień;
   cache w localStorage per (symbol, data) — ceny historyczne się nie zmieniają.
4. Nowe kafelki w `PortfolioSummaryPanel` (4 bilanse + bieżąca wartość), filtr kategorii, dopiski "od DD.MM" przy niepełnych danych.
5. Pola "data zakupu" + `createdAt`.
6. Dziennik zrealizowanych: kupony obligacji (wyliczane), potem import XTB (po obejrzeniu pliku), potem ręczne dodawanie.
7. Testy logiki z pkt 3 na przypadkach: zakup przed okresem / w okresie / dziś, pozycja w walucie obcej, weekend, 1 stycznia, kupon w okresie.

## 8. Pomysły na później
- Stopa zwrotu realna (po inflacji — jest `inflationData.js`) zamiast usuniętej "średniej rocznej".
- Rozbicie bilansu okresu na kategorie po kliknięciu kafelka.
- Najlepsza/najgorsza pozycja okresu.
