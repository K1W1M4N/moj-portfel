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

# Nagłówki udające prawdziwą przeglądarkę
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}

def get_excel_url():
    """Pobierz URL do aktualnego kalkulatora Excel ze strony bloga"""
    print("Pobieram stronę bloga...")
    session = requests.Session()
    resp = session.get(BLOG_URL, headers=HEADERS, timeout=30)
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")

    # Szukaj linku do pliku XLSX kalkulatora
    for link in soup.find_all("a", href=True):
        href = link["href"]
        if "Kalkulator-obligacji" in href and href.endswith(".xlsx"):
            print(f"Znalazłem kalkulator: {href}")
            return href, session

    raise Exception("Nie znalazłem linku do kalkulatora Excel na stronie!")

def download_excel(url, session):
    """Pobierz plik Excel używając tej samej sesji"""
    print(f"Pobieram Excel: {url}")
    excel_headers = {**HEADERS, "Accept": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*"}
    resp = session.get(url, headers=excel_headers, timeout=60)
    resp.raise_for_status()
    return BytesIO(resp.content)

def extract_rates_from_excel(excel_file):
    """Wyciągnij stawki roku 1 dla każdego typu obligacji z Excela"""
    wb = openpyxl.load_workbook(excel_file, data_only=True)
    print(f"Arkusze: {wb.sheetnames}")

    now = datetime.now()
    year_month = f"{now.year}-{now.month:02d}"
    rates = {}

    # Typy obligacji do szukania
    bond_types = ["TOS", "COI", "EDO", "ROS", "ROD", "ROR", "DOR"]

    # Szukaj w arkuszu WPISZ ZAŁOŻENIA
    target_sheet = None
    for name in ["WPISZ ZAŁOŻENIA", "ZAŁOŻENIA", "Sheet1"]:
        if name in wb.sheetnames:
            target_sheet = wb[name]
            break
    if not target_sheet:
        target_sheet = wb.active

    print(f"Szukam stawek w arkuszu: {target_sheet.title}")

    # Przejdź wszystkie wiersze
    for row in target_sheet.iter_rows():
        for i, cell in enumerate(row):
            if not cell.value:
                continue
            cell_str = str(cell.value).strip()

            for bond_type in bond_types:
                if bond_type in cell_str and bond_type not in rates:
                    # Szukaj wartości procentowej w tej samej lub następnej kolumnie
                    for offset in range(1, 5):
                        try:
                            next_cell = row[i + offset]
                            val = next_cell.value
                            if isinstance(val, float) and 0.005 < val < 0.30:
                                rates[bond_type] = val
                                print(f"  {bond_type}: {val*100:.2f}%")
                                break
                            elif isinstance(val, (int, float)) and 0.5 < val < 30:
                                # Wartość podana w procentach (np. 5.65 zamiast 0.0565)
                                rates[bond_type] = val / 100
                                print(f"  {bond_type}: {val:.2f}%")
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
        # Sprawdź czy ten miesiąc już istnieje dla tego typu
        # Szukaj bloku np. TOS: { ... }
        block_pattern = rf'({bond_type}:\s*\{{)(.*?)(\n  \}})'
        match = re.search(block_pattern, content, re.DOTALL)

        if not match:
            print(f"  {bond_type}: nie znaleziono bloku w bondRates.js")
            continue

        block_content = match.group(2)

        if year_month in block_content:
            print(f"  {bond_type}: {year_month} już istnieje, pomijam")
            continue

        # Dodaj nowy wpis na końcu bloku
        new_line = f'\n    "{year_month}":{rate:.4f},'
        new_block = match.group(1) + block_content + new_line + match.group(3)
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
