#!/usr/bin/env python3
"""
Skrypt aktualizujący dane inflacji GUS w inflationData.js
Źródło: stat.gov.pl (GUS) - wskaźniki CPI YoY
Uruchamiany przez GitHub Actions ~20. dnia każdego miesiąca
(GUS publikuje dane ok. 15. dnia miesiąca za poprzedni miesiąc)
"""

import re
import sys
import requests
from datetime import datetime, timedelta
from io import BytesIO

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Connection": "keep-alive",
}

# GUS udostępnia dane CPI w formacie CSV przez API BDL
# Wskaźnik P2516 = CPI YoY (rok poprzedni = 100)
# https://bdl.stat.gov.pl/api/v1/
GUS_API_URL = "https://bdl.stat.gov.pl/api/v1/data/by-variable/4220?unit-level=0&format=json&page-size=100&lang=pl"

def fetch_from_gus_api():
    """Pobierz dane inflacji z API BDL GUS"""
    print("Pobieram dane z API BDL GUS...")
    resp = requests.get(GUS_API_URL, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    results = data.get("results", [])
    if not results:
        raise Exception("Brak wyników z API GUS")

    inflation_data = {}
    for item in results:
        values = item.get("values", [])
        for v in values:
            year = v.get("year")
            period = v.get("period", "")  # np. "M01", "M02", ...
            val = v.get("val")

            if not year or not period or val is None:
                continue
            if not period.startswith("M"):
                continue

            month = int(period[1:])
            # Wartość to indeks (rok poprz. = 100), np. 105.3 = +5.3%
            inflation_rate = (float(val) - 100) / 100

            year_month = f"{year}-{month:02d}"
            inflation_data[year_month] = round(inflation_rate, 4)

    return inflation_data

def fetch_fallback():
    """
    Fallback: pobierz z głównej strony GUS komunikat o inflacji
    Szuka ostatniego ogłoszonego odczytu CPI
    """
    print("Próba fallback - strona GUS...")
    url = "https://stat.gov.pl/obszary-tematyczne/ceny-handel/wskazniki-cen/wskazniki-cen-towarow-i-uslug-konsumpcyjnych-komunikat/"
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()

    # Szukaj wartości procentowej inflacji
    patterns = [
        r'(\d{1,2},\d{1,2})\s*%',
        r'wzrosły o\s+(\d{1,2},\d{1,2})\s*%',
        r'(\d{1,2}\.\d{1,2})\s*%',
    ]

    for pattern in patterns:
        matches = re.findall(pattern, resp.text)
        if matches:
            val_str = matches[0].replace(",", ".")
            try:
                val = float(val_str) / 100
                if 0 < val < 0.5:  # sensowny zakres inflacji
                    now = datetime.now()
                    # GUS publikuje dane za poprzedni miesiąc
                    prev_month = now.month - 1 if now.month > 1 else 12
                    prev_year = now.year if now.month > 1 else now.year - 1
                    year_month = f"{prev_year}-{prev_month:02d}"
                    print(f"Znaleziono inflację {val*100:.1f}% dla {year_month}")
                    return {year_month: round(val, 4)}
            except:
                pass

    return {}

def update_inflation_js(new_data, js_file_path="src/inflationData.js"):
    """Zaktualizuj plik inflationData.js o nowe dane"""
    if not new_data:
        print("Brak nowych danych do aktualizacji!")
        return False

    print(f"\nAktualizuję {js_file_path}...")

    with open(js_file_path, "r", encoding="utf-8") as f:
        content = f.read()

    updated = False

    for year_month, rate in sorted(new_data.items()):
        if year_month in content:
            # Sprawdź czy wartość się zmieniła
            pattern = rf'"{year_month}":([\d.]+)'
            match = re.search(pattern, content)
            if match:
                existing = float(match.group(1))
                if abs(existing - rate) < 0.0001:
                    print(f"  {year_month}: {rate*100:.2f}% — bez zmian")
                    continue
                else:
                    # Zaktualizuj istniejącą wartość
                    content = re.sub(pattern, f'"{year_month}":{rate:.4f}', content)
                    print(f"  ✓ {year_month}: zaktualizowano {existing*100:.2f}% → {rate*100:.2f}%")
                    updated = True
            continue

        # Dodaj nowy wpis — znajdź ostatni wpis w bloku INFLATION_HISTORY
        # i dodaj po nim
        block_pattern = r'(export const INFLATION_HISTORY = \{)(.*?)(\};)'
        match = re.search(block_pattern, content, re.DOTALL)
        if not match:
            print(f"  ✗ Nie znaleziono bloku INFLATION_HISTORY")
            continue

        block_content = match.group(2)
        new_line = f'\n  "{year_month}":{rate:.4f},'
        new_block = match.group(1) + block_content + new_line + "\n" + match.group(3)
        content = content[:match.start()] + new_block + content[match.end():]

        # Zaktualizuj komentarz z datą
        content = re.sub(
            r'// Ostatnia aktualizacja: \d{4}-\d{2}',
            f'// Ostatnia aktualizacja: {year_month}',
            content
        )

        print(f"  ✓ {year_month}: dodano {rate*100:.2f}%")
        updated = True

    if updated:
        with open(js_file_path, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"\n✓ Zapisano {js_file_path}")
    else:
        print("\n! Brak zmian do zapisania")

    return updated

def main():
    print("=== Aktualizacja danych inflacji GUS ===")
    print(f"Data: {datetime.now().strftime('%Y-%m-%d %H:%M')}\n")

    new_data = {}

    # Próba 1: API BDL GUS
    try:
        new_data = fetch_from_gus_api()
        print(f"Pobrano {len(new_data)} rekordów z API BDL GUS")
        if new_data:
            latest = max(new_data.keys())
            print(f"Najnowszy rekord: {latest} = {new_data[latest]*100:.2f}%")
    except Exception as e:
        print(f"API BDL niedostępne: {e}")

    # Próba 2: fallback ze strony GUS
    if not new_data:
        try:
            new_data = fetch_fallback()
        except Exception as e:
            print(f"Fallback niedostępny: {e}")

    if not new_data:
        print("\n✗ Nie udało się pobrać danych inflacji")
        sys.exit(1)

    updated = update_inflation_js(new_data)

    if updated:
        print("\n✓ Aktualizacja zakończona sukcesem!")
    else:
        print("\n! Brak nowych danych")

if __name__ == "__main__":
    main()
