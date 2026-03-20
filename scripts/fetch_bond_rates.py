#!/usr/bin/env python3
"""
Skrypt aktualizujący stawki obligacji skarbowych w bondRates.js
Źródło: kalkulator Marcina Iwucia (aktualizowany co miesiąc)
"""

import re
import sys
import requests
from datetime import datetime
from bs4 import BeautifulSoup
import openpyxl
from io import BytesIO

BLOG_URL = "https://marciniwuc.com/obligacje-indeksowane-inflacja-kalkulator/"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pl-PL,pl;q=0.9",
    "Connection": "keep-alive",
}

# Typy które mają stałą stawkę roku 1 w kalkulatorze Marcina Iwucia
# ROR i DOR pomijamy — mają zmienną stopę NBP, nie stałą stawkę roku 1
BOND_TYPES_TO_UPDATE = ["TOS", "COI", "EDO", "ROS", "ROD"]

# Kolumna 2 (index=2) w Excelu to "% dla pierwszego okresu odsetkowego"
# Wiersz dla każdego typu zaczyna się od nazwy w kolumnie 0
BOND_ROW_NAMES = {
    "TOS": "TOS",
    "COI": "COI",
    "EDO": "EDO",
    "ROS": "ROS",
    "ROD": "ROD",
}

def get_excel_url():
    print("Pobieram stronę bloga...")
    session = requests.Session()
    resp = session.get(BLOG_URL, headers=HEADERS, timeout=30)
    resp.raise_for_status()

    xlsx_pattern = r'https://marciniwuc\.com/wp-content/uploads/\d{4}/\d{2}/Kalkulator-obligacji[^"\']*\.xlsx'
    matches = re.findall(xlsx_pattern, resp.text)
    if matches:
        print(f"Znalazłem kalkulator: {matches[0]}")
        return matches[0], session

    raise Exception("Nie znalazłem linku do kalkulatora Excel!")

def download_excel(url, session):
    print(f"Pobieram Excel: {url}")
    resp = session.get(url, headers=HEADERS, timeout=60)
    resp.raise_for_status()
    print(f"Pobrano {len(resp.content)} bajtów")
    return BytesIO(resp.content)

def extract_rates_from_excel(excel_file):
    """
    Wyciągnij stawki z arkusza 'WPISZ ZAŁOŻENIA'.
    Struktura (potwierdzona z logów):
    Wiersz 29: nagłówki kolumn
    Wiersz 30: ROR  | col1=zapadalność | col2=stawka_rok1 | ...
    Wiersz 31: DOR  | ...
    Wiersz 32: TOS  | ...
    Wiersz 33: COI  | ...
    Wiersz 34: EDO  | ...
    Wiersz 35: ROS  | ...
    Wiersz 36: ROD  | ...
    """
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
                # Kolumna 2 (index=2) = stawka roku 1
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
    print(f"Data: {datetime.now().strftime('%Y-%m-%d %H:%M')}\n")

    try:
        excel_url, session = get_excel_url()
        excel_file = download_excel(excel_url, session)
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
