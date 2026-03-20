#!/usr/bin/env python3
"""
Skrypt aktualizujący stawki obligacji skarbowych w bondRates.js
Źródło: kalkulator Marcina Iwucia (aktualizowany co miesiąc)
"""

import re
import sys
import requests
from datetime import datetime, timedelta
import openpyxl
from io import BytesIO

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Connection": "keep-alive",
}

MONTHS_PL = {
    1: "styczen", 2: "luty", 3: "marzec", 4: "kwiecien",
    5: "maj", 6: "czerwiec", 7: "lipiec", 8: "sierpien",
    9: "wrzesien", 10: "pazdziernik", 11: "listopad", 12: "grudzien"
}

BOND_TYPES_TO_UPDATE = ["TOS", "COI", "EDO", "ROS", "ROD"]

def build_excel_urls(dt):
    """
    Buduj możliwe URL do Excela dla danego miesiąca.
    Format: /wp-content/uploads/YYYY/MM/Kalkulator-obligacji-MIESIAC-YYYY-Finanse-Bardzo-Osobiste.xlsx
    Marcin publikuje nowy kalkulator zazwyczaj w miesiącu poprzednim.
    """
    year = dt.year
    month = dt.month
    month_name = MONTHS_PL[month]
    # Plik jest uploadowany miesiąc wcześniej (np. marzec 2026 uploadowany w lutym 2026)
    upload_month = f"{month - 1:02d}" if month > 1 else "12"
    upload_year = year if month > 1 else year - 1

    urls = [
        f"https://marciniwuc.com/wp-content/uploads/{upload_year}/{upload_month}/Kalkulator-obligacji-{month_name}-{year}-Finanse-Bardzo-Osobiste.xlsx",
        f"https://marciniwuc.com/wp-content/uploads/{year}/{month:02d}/Kalkulator-obligacji-{month_name}-{year}-Finanse-Bardzo-Osobiste.xlsx",
    ]
    return urls

def download_excel(dt):
    """Spróbuj pobrać Excel dla danego miesiąca"""
    urls = build_excel_urls(dt)
    for url in urls:
        print(f"Próbuję: {url}")
        try:
            resp = requests.get(url, headers=HEADERS, timeout=60)
            if resp.status_code == 200 and len(resp.content) > 10000:
                print(f"✓ Pobrano {len(resp.content)} bajtów")
                return BytesIO(resp.content)
            else:
                print(f"  Status: {resp.status_code}, rozmiar: {len(resp.content)}")
        except Exception as e:
            print(f"  Błąd: {e}")

    # Spróbuj poprzedni miesiąc
    prev = dt.replace(day=1) - timedelta(days=1)
    print(f"\nPróbuję poprzedni miesiąc: {prev.strftime('%Y-%m')}")
    for url in build_excel_urls(prev):
        print(f"Próbuję: {url}")
        try:
            resp = requests.get(url, headers=HEADERS, timeout=60)
            if resp.status_code == 200 and len(resp.content) > 10000:
                print(f"✓ Pobrano {len(resp.content)} bajtów")
                return BytesIO(resp.content)
        except Exception as e:
            print(f"  Błąd: {e}")

    raise Exception("Nie udało się pobrać kalkulatora Excel!")

def extract_rates_from_excel(excel_file):
    """Wyciągnij stawki roku 1 z arkusza WPISZ ZAŁOŻENIA"""
    wb = openpyxl.load_workbook(excel_file, data_only=True)
    ws = wb["WPISZ ZAŁOŻENIA"]

    now = datetime.now()
    year_month = f"{now.year}-{now.month:02d}"
    rates = {}

    for row in ws.iter_rows(values_only=True):
        if not row[0]:
            continue
        row0 = str(row[0]).strip()
        for bond_type in BOND_TYPES_TO_UPDATE:
            if row0.startswith(bond_type):
                rate_val = row[2]
                if isinstance(rate_val, float) and 0.005 < rate_val < 0.30:
                    rates[bond_type] = rate_val
                    print(f"  {bond_type}: {rate_val*100:.2f}%")

    return rates, year_month

def update_bond_rates_js(rates, year_month, js_file_path="src/bondRates.js"):
    if not rates:
        print("Brak stawek do aktualizacji!")
        return False

    print(f"\nAktualizuję {js_file_path} dla miesiąca {year_month}...")

    with open(js_file_path, "r", encoding="utf-8") as f:
        content = f.read()

    updated = False

    for bond_type, rate in rates.items():
        block_pattern = rf'({bond_type}:\s*\{{)(.*?)(\n  \}})'
        match = re.search(block_pattern, content, re.DOTALL)

        if not match:
            print(f"  {bond_type}: nie znaleziono bloku w bondRates.js")
            continue

        if year_month in match.group(2):
            print(f"  {bond_type}: {year_month} już istnieje, pomijam")
            continue

        new_line = f'\n    "{year_month}":{rate:.4f},'
        new_block = match.group(1) + match.group(2) + new_line + match.group(3)
        content = content[:match.start()] + new_block + content[match.end():]
        print(f"  ✓ {bond_type}: dodano {year_month} = {rate*100:.2f}%")
        updated = True

    if updated:
        with open(js_file_path, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"\n✓ Zapisano {js_file_path}")

    return updated

def main():
    print("=== Aktualizacja stawek obligacji skarbowych ===")
    now = datetime.now()
    print(f"Data: {now.strftime('%Y-%m-%d %H:%M')}\n")

    try:
        excel_file = download_excel(now)
        rates, year_month = extract_rates_from_excel(excel_file)
        print(f"\nZnalezione stawki dla {year_month}: {rates}")
        updated = update_bond_rates_js(rates, year_month)

        if updated:
            print("\n✓ Aktualizacja zakończona sukcesem!")
        else:
            print("\n! Brak zmian do zapisania")

    except Exception as e:
        print(f"\n✗ Błąd: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
