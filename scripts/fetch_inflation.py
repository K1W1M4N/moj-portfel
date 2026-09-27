#!/usr/bin/env python3
"""
Skrypt aktualizujący dane inflacji GUS w inflationData.js
Źródło: GUS, "Miesięczne wskaźniki cen towarów i usług konsumpcyjnych od 1982 roku" (CSV)
Uruchamiany przez GitHub Actions ~20. dnia każdego miesiąca

Poprzednie źródła przestały działać: Stooq zasłania CSV weryfikacją JavaScript,
a zmienna 2955 w API BDL to nie inflacja (liczba szkół zawodowych z 1999 r.).
"""

import csv
import io
import re
import sys
from datetime import date
from decimal import Decimal

import requests

GUS_PAGE_URL = (
    "https://stat.gov.pl/obszary-tematyczne/ceny-handel/wskazniki-cen/"
    "wskazniki-cen-towarow-i-uslug-konsumpcyjnych-pot-inflacja-/"
    "miesieczne-wskazniki-cen-towarow-i-uslug-konsumpcyjnych-od-1982-roku/"
)
GUS_BASE_URL = "https://stat.gov.pl"
# Nazwa pliku ma zmienny sufiks (np. ..._8.csv), więc link wyciągamy ze strony
CSV_LINK_RE = re.compile(r'href="([^"]*miesiecznewskaznikicentowarowiuslugkonsumpcyjnychod1982roku[^"]*\.csv)"')
YOY_MEASURE = "Analogiczny miesiąc poprzedniego roku = 100"

START_MONTH = "2015-01"
MAX_AGE_MONTHS = 4       # najnowszy miesiąc starszy niż to = coś jest nie tak ze źródłem
JS_FILE_PATH = "src/inflationData.js"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.7",
}


def fetch_gus_csv():
    """Znajdź link do CSV na stronie GUS i pobierz plik"""
    print(f"Pobieram stronę GUS: {GUS_PAGE_URL}")
    page = requests.get(GUS_PAGE_URL, headers=HEADERS, timeout=30)
    page.raise_for_status()

    match = CSV_LINK_RE.search(page.text)
    if not match:
        raise RuntimeError("Nie znaleziono linku do CSV na stronie GUS (zmienił się markup?)")
    csv_url = match.group(1)
    if csv_url.startswith("/"):
        csv_url = GUS_BASE_URL + csv_url

    print(f"Pobieram CSV: {csv_url}")
    resp = requests.get(csv_url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    return resp.content.decode("cp1250")


def parse_yoy_inflation(csv_text):
    """Wyciągnij CPI r/r dla Polski jako {"YYYY-MM": ułamek}, np. 102,9 -> 0.029"""
    # Kolumny: Nazwa zmiennej;Jednostka terytorialna;Sposób prezentacji;Rok;Miesiąc;Wartość;Flaga
    data = {}
    for row in csv.reader(io.StringIO(csv_text), delimiter=";"):
        if len(row) < 6 or row[1] != "Polska" or row[2] != YOY_MEASURE:
            continue
        value = row[5].strip()
        if not value:
            continue  # miesiące jeszcze nieopublikowane są w pliku puste
        year_month = f"{int(row[3])}-{int(row[4]):02d}"
        if year_month < START_MONTH:
            continue
        rate = (Decimal(value.replace(",", ".")) - 100) / 100
        data[year_month] = rate.quantize(Decimal("0.0001"))
    return data


def validate(data):
    """Rzuć wyjątek, jeśli dane wyglądają na niekompletne albo nieaktualne"""
    if not data:
        raise RuntimeError("CSV nie zawiera danych r/r dla Polski (zmienił się format?)")

    keys = sorted(data)
    y, m = map(int, keys[0].split("-"))
    expected = []
    while f"{y}-{m:02d}" <= keys[-1]:
        expected.append(f"{y}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    missing = [k for k in expected if k not in data]
    if missing:
        raise RuntimeError(f"Brakujące miesiące w danych GUS: {missing}")

    for k, v in data.items():
        if not Decimal("-0.1") < v < Decimal("0.5"):
            raise RuntimeError(f"Wartość poza sensownym zakresem: {k} = {v}")

    today = date.today()
    ly, lm = map(int, keys[-1].split("-"))
    age = (today.year - ly) * 12 + (today.month - lm)
    if age > MAX_AGE_MONTHS:
        raise RuntimeError(f"Najnowsze dane GUS są za {keys[-1]} — starsze niż {MAX_AGE_MONTHS} mies.")


def render_history_block(data):
    """Blok INFLATION_HISTORY, po 4 miesiące w linii"""
    items = [f'"{k}":{data[k]:.4f}' for k in sorted(data)]
    lines = ["  " + ",".join(items[i:i + 4]) + "," for i in range(0, len(items), 4)]
    return "export const INFLATION_HISTORY = {\n" + "\n".join(lines) + "\n};"


def update_inflation_js(data, js_file_path=JS_FILE_PATH):
    """Podmień cały blok INFLATION_HISTORY i datę ostatniej aktualizacji"""
    with open(js_file_path, "r", encoding="utf-8") as f:
        content = f.read()

    block_re = re.compile(r"export const INFLATION_HISTORY = \{.*?\n\};", re.DOTALL)
    if not block_re.search(content):
        raise RuntimeError(f"Nie znaleziono bloku INFLATION_HISTORY w {js_file_path}")

    new_content = block_re.sub(lambda _: render_history_block(data), content, count=1)
    new_content = re.sub(
        r"// Ostatnia aktualizacja: \d{4}-\d{2}",
        f"// Ostatnia aktualizacja: {max(data)}",
        new_content,
    )

    if new_content == content:
        return False
    with open(js_file_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(new_content)
    return True


def main():
    print("=== Aktualizacja danych inflacji GUS ===")
    try:
        data = parse_yoy_inflation(fetch_gus_csv())
        validate(data)
    except Exception as e:
        # Kończymy błędem, żeby awaria była widoczna w GitHub Actions (wcześniej
        # skrypt wychodził z kodem 0 i dane po cichu stały w miejscu przez pół roku)
        print(f"\n✗ Nie udało się pobrać danych inflacji: {e}")
        sys.exit(1)

    print(f"✓ GUS: {len(data)} miesięcy, {min(data)} … {max(data)}")
    for k in sorted(data)[-6:]:
        print(f"  {k}: {data[k] * 100:.1f}%")

    if update_inflation_js(data):
        print(f"\n✓ Zapisano {JS_FILE_PATH}")
    else:
        print("\n! Dane aktualne, brak zmian.")


if __name__ == "__main__":
    main()
