#!/usr/bin/env python3
"""
Skrypt aktualizujący dane inflacji GUS w inflationData.js
Źródło: stooq.pl (dane CPI YoY dla Polski)
Uruchamiany przez GitHub Actions ~20. dnia każdego miesiąca
"""

import re
import sys
import requests
from datetime import datetime, timedelta

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.7",
    "Connection": "keep-alive",
}

def fetch_from_stooq():
    """Pobierz dane CPI YoY z Stooq — wskaźnik cpiypl (CPI Polska YoY)"""
    url = "https://stooq.pl/q/d/l/?s=cpiypl&i=m"
    print(f"Pobieram dane z Stooq: {url}")
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()

    lines = resp.text.strip().split("\n")
    print(f"Pobrano {len(lines)} linii")

    # Format CSV: Date,Open,High,Low,Close,Volume
    # Data: YYYY-MM-DD, wartość to % YoY
    data = {}
    for line in lines[1:]:  # pomijamy nagłówek
        parts = line.strip().split(",")
        if len(parts) < 5:
            continue
        date_str = parts[0]  # np. "2026-02-28"
        close = parts[4]     # wartość CPI YoY
        try:
            year_month = date_str[:7]  # "2026-02"
            val = float(close) / 100   # np. 5.3 -> 0.053
            if -0.1 < val < 0.5:       # sensowny zakres
                data[year_month] = round(val, 4)
        except:
            continue

    return data

def fetch_from_stooq_alternative():
    """Alternatywny ticker na Stooq"""
    url = "https://stooq.pl/q/d/l/?s=cpi.pl&i=m"
    print(f"Próba alternatywnego tickera Stooq: {url}")
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()

    lines = resp.text.strip().split("\n")
    print(f"Pobrano {len(lines)} linii")

    data = {}
    for line in lines[1:]:
        parts = line.strip().split(",")
        if len(parts) < 5:
            continue
        date_str = parts[0]
        close = parts[4]
        try:
            year_month = date_str[:7]
            val = float(close) / 100
            if -0.1 < val < 0.5:
                data[year_month] = round(val, 4)
        except:
            continue

    return data

def fetch_from_gus_api():
    """Pobierz z API BDL GUS — zmienna 2955 to CPI miesięczny YoY"""
    # Poprawny URL API BDL GUS dla CPI YoY miesięcznego
    url = "https://bdl.stat.gov.pl/api/v1/data/by-variable/2955?unit-level=0&format=json&page-size=100&lang=pl"
    print(f"Pobieram z API BDL GUS: {url}")
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()

    data_json = resp.json()
    results = data_json.get("results", [])
    if not results:
        print("  Brak wyników")
        return {}

    print(f"  Wyników: {len(results)}")
    inflation_data = {}

    for item in results:
        for v in item.get("values", []):
            year = v.get("year")
            period = v.get("period", "")
            val = v.get("val")
            if not year or not period.startswith("M") or val is None:
                continue
            month = int(period[1:])
            # Wartość to indeks rok/rok (rok poprz. = 100), np. 105.3 = +5.3%
            inflation_rate = round((float(val) - 100) / 100, 4)
            if -0.1 < inflation_rate < 0.5:
                year_month = f"{year}-{month:02d}"
                inflation_data[year_month] = inflation_rate

    return inflation_data

def update_inflation_js(new_data, js_file_path="src/inflationData.js"):
    """Zaktualizuj plik inflationData.js o nowe dane"""
    if not new_data:
        print("Brak nowych danych do aktualizacji!")
        return False

    # Pokaż najnowsze dane
    latest_keys = sorted(new_data.keys())[-6:]
    print(f"\nNajnowsze dane:")
    for k in latest_keys:
        print(f"  {k}: {new_data[k]*100:.2f}%")

    with open(js_file_path, "r", encoding="utf-8") as f:
        content = f.read()

    updated = False

    for year_month, rate in sorted(new_data.items()):
        # Sprawdź czy wpis już istnieje
        pattern = rf'"{year_month}":([\d.]+)'
        match = re.search(pattern, content)

        if match:
            existing = float(match.group(1))
            if abs(existing - rate) > 0.0001:
                content = re.sub(pattern, f'"{year_month}":{rate:.4f}', content)
                print(f"  ✓ {year_month}: zaktualizowano {existing*100:.2f}% → {rate*100:.2f}%")
                updated = True
        else:
            # Dodaj nowy wpis przed zamknięciem bloku INFLATION_HISTORY
            block_pattern = r'(export const INFLATION_HISTORY = \{)(.*?)(\n\};)'
            block_match = re.search(block_pattern, content, re.DOTALL)
            if block_match:
                new_line = f'\n  "{year_month}":{rate:.4f},'
                new_content = (
                    block_match.group(1) +
                    block_match.group(2) +
                    new_line + "\n" +
                    block_match.group(3)
                )
                content = content[:block_match.start()] + new_content + content[block_match.end():]
                print(f"  ✓ {year_month}: dodano {rate*100:.2f}%")
                updated = True

    if updated:
        # Zaktualizuj komentarz z datą
        latest = max(new_data.keys())
        content = re.sub(
            r'// Ostatnia aktualizacja: \d{4}-\d{2}',
            f'// Ostatnia aktualizacja: {latest}',
            content
        )
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

    # Próba 1: Stooq (główne źródło)
    try:
        new_data = fetch_from_stooq()
        if new_data:
            print(f"✓ Stooq: pobrano {len(new_data)} rekordów")
        else:
            print("✗ Stooq: brak danych")
    except Exception as e:
        print(f"✗ Stooq niedostępny: {e}")

    # Próba 2: Stooq alternatywny ticker
    if not new_data:
        try:
            new_data = fetch_from_stooq_alternative()
            if new_data:
                print(f"✓ Stooq alt: pobrano {len(new_data)} rekordów")
        except Exception as e:
            print(f"✗ Stooq alt niedostępny: {e}")

    # Próba 3: API BDL GUS
    if not new_data:
        try:
            new_data = fetch_from_gus_api()
            if new_data:
                print(f"✓ BDL GUS: pobrano {len(new_data)} rekordów")
        except Exception as e:
            print(f"✗ BDL GUS niedostępny: {e}")

    if not new_data:
        print("\n✗ Wszystkie źródła niedostępne. Używam danych z pliku (bez zmian).")
        # Nie kończymy z błędem — plik historyczny nadal działa
        sys.exit(0)

    updated = update_inflation_js(new_data)
    if updated:
        print("\n✓ Aktualizacja zakończona sukcesem!")
    else:
        print("\n! Dane aktualne, brak zmian.")

if __name__ == "__main__":
    main()
