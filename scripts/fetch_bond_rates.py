#!/usr/bin/env python3
"""
Skrypt aktualizujący stawki obligacji skarbowych w bondRates.js
Źródło: strona marciniwuc.com (kalkulator aktualizowany co miesiąc)
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

def get_excel_url():
    """Pobierz URL do aktualnego kalkulatora Excel ze strony bloga"""
    print("Pobieram stronę bloga...")
    session = requests.Session()
    resp = session.get(BLOG_URL, headers=HEADERS, timeout=30)
    resp.raise_for_status()

    print(f"Status: {resp.status_code}, długość: {len(resp.text)}")

    # Szukaj bezpośrednio w HTML przez regex — szukamy XLSX z wp-content/uploads
    # Link wygląda tak: https://marciniwuc.com/wp-content/uploads/2026/02/Kalkulator-obligacji-*.xlsx
    xlsx_pattern = r'https://marciniwuc\.com/wp-content/uploads/\d{4}/\d{2}/Kalkulator-obligacji[^"\']*\.xlsx'
    matches = re.findall(xlsx_pattern, resp.text)

    if matches:
        # Weź pierwszy znaleziony link (to kalkulator główny)
        url = matches[0]
        print(f"Znalazłem kalkulator: {url}")
        return url, session

    # Alternatywnie — szukaj przez BeautifulSoup
    soup = BeautifulSoup(resp.text, "html.parser")
    for link in soup.find_all("a", href=True):
        href = link["href"]
        if "wp-content/uploads" in href and ".xlsx" in href and "Kalkulator" in href:
            print(f"Znalazłem przez BS4: {href}")
            return href, session

    # Debug — pokaż wszystkie linki do xlsx
    all_xlsx = re.findall(r'https?://[^\s"\']*\.xlsx', resp.text)
    print(f"Wszystkie linki xlsx na stronie: {all_xlsx}")

    raise Exception("Nie znalazłem linku do kalkulatora Excel na stronie!")

def download_excel(url, session):
    """Pobierz plik Excel"""
    print(f"Pobieram Excel: {url}")
    resp = session.get(url, headers=HEADERS, timeout=60)
    resp.raise_for_status()
    print(f"Pobrano {len(resp.content)} bajtów")
    return BytesIO(resp.content)

def extract_rates_from_excel(excel_file):
    """Wyciągnij stawki roku 1 dla każdego typu obligacji z Excela"""
    wb = openpyxl.load_workbook(excel_file, data_only=True)
    print(f"Arkusze: {wb.sheetnames}")

    now = datetime.now()
    year_month = f"{now.year}-{now.month:02d}"
    rates = {}
    bond_types = ["TOS", "COI", "EDO", "ROS", "ROD", "ROR", "DOR"]

    # Szukaj w arkuszu z założeniami
    target_sheet = None
    for name in ["WPISZ ZAŁOŻENIA", "ZAŁOŻENIA", "Założenia"]:
        if name in wb.sheetnames:
            target_sheet = wb[name]
            break
    if not target_sheet:
        target_sheet = wb.active

    print(f"Szukam w arkuszu: {target_sheet.title}")

    # Wypisz pierwsze 40 wierszy dla debugowania
    print("\nPierwsze 40 wierszy arkusza:")
    for i, row in enumerate(target_sheet.iter_rows(values_only=True)):
        if i > 40:
            break
        non_empty = [(j, v) for j, v in enumerate(row) if v is not None]
        if non_empty:
            print(f"  Wiersz {i+1}: {non_empty}")

    # Szukaj stawek
    for row in target_sheet.iter_rows():
        for i, cell in enumerate(row):
            if not cell.value:
                continue
            cell_str = str(cell.value).strip()
            for bond_type in bond_types:
                if bond_type in cell_str and bond_type not in rates:
                    for offset in range(1, 6):
                        try:
                            next_val = row[i + offset].value
                            if isinstance(next_val, float) and 0.005 < next_val < 0.30:
                                rates[bond_type] = next_val
                                print(f"  {bond_type}: {next_val*100:.2f}%")
                                break
                            elif isinstance(next_val, (int, float)) and 0.5 < next_val < 30:
                                rates[bond_type] = next_val / 100
                                print(f"  {bond_type}: {next_val:.2f}%")
                                break
                        except IndexError:
                            break

    return rates, year_month

def update_bond_rates_js(rates, year_month, js_file_path="src/bondRates.js"):
    """Zaktualizuj plik bondRates.js o nowe stawki"""
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
