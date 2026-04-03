#!/usr/bin/env python3
"""
Skrypt aktualizujący stawki obligacji skarbowych w bondRates.js
Źródło: oficjalne komunikaty Ministerstwa Finansów (obligacjeskarbowe.pl)

URL komunikatu: /komunikaty/z-dniem-1-{miesiąc_dopełniacz}-{rok}-r-rozpoczyna-sie-sprzedaz-obligacji/
Komunikat ukazuje się 1. dnia każdego miesiąca i zawiera stawki rok 1 dla wszystkich typów.
"""

import re
import sys
import requests
from datetime import datetime, timedelta
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Connection": "keep-alive",
}

# Nazwy miesięcy w dopełniaczu — dokładnie tak jak w URL komunikatów MF
MONTHS_PL_GEN = {
    1:  "stycznia",    2:  "lutego",      3:  "marca",
    4:  "kwietnia",    5:  "maja",        6:  "czerwca",
    7:  "lipca",       8:  "sierpnia",    9:  "wrzesnia",
    10: "pazdziernika",11: "listopada",   12: "grudnia",
}

BOND_TYPES_ALL = ["TOS", "COI", "EDO", "ROS", "ROD", "ROR", "DOR"]

BASE_URL = (
    "https://www.obligacjeskarbowe.pl/komunikaty/"
    "z-dniem-1-{month}-{year}-r-rozpoczyna-sie-sprzedaz-obligacji/"
)


def fetch_official_rates(dt):
    """Pobiera stawki rok 1 z oficjalnego komunikatu MF dla podanego miesiąca."""
    month_pl = MONTHS_PL_GEN[dt.month]
    url = BASE_URL.format(month=month_pl, year=dt.year)
    print(f"Próbuję: {url}")

    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        if resp.status_code != 200:
            print(f"  Brak strony (HTTP {resp.status_code})")
            return {}
        print(f"  ✓ Pobrano stronę ({len(resp.content)} bajtów)")
        return parse_rates_from_html(resp.text)
    except Exception as e:
        print(f"  Błąd: {e}")
        return {}


def parse_rates_from_html(html):
    """
    Parsuje stawki rok 1 z HTML komunikatu obligacjeskarbowe.pl.

    Strona zawiera wzorce w stylu:
        TOS0428 ... wynosi 5,95%
        ROR0126 ... wynosi 5,75% w skali roku
    Szukamy kodu obligacji (np. TOS0428) i bierzemy pierwszy procent
    w ciągu 600 znaków po nim.
    """
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text(separator=" ")

    rates = {}

    for bond_type in BOND_TYPES_ALL:
        # Szukaj kodu z numerem (TOS0428) lub samego skrótu (TOS)
        match = re.search(rf'{bond_type}\d+', text, re.IGNORECASE)
        if not match:
            match = re.search(rf'\b{bond_type}\b', text, re.IGNORECASE)
        if not match:
            print(f"  {bond_type}: nie znaleziono na stronie")
            continue

        # Szukaj procentu w ciągu 600 znaków po znalezionym kodzie
        snippet = text[match.start(): match.start() + 600]
        pct_matches = re.findall(r'(\d+[,\.]\d+)\s*%', snippet)

        if not pct_matches:
            print(f"  {bond_type}: znaleziono wzmiankę, ale bez wartości %")
            continue

        rate_str = pct_matches[0].replace(",", ".")
        rate = float(rate_str) / 100

        if 0.005 < rate < 0.30:
            rates[bond_type] = rate
            print(f"  ✓ {bond_type}: {rate * 100:.2f}%")
        else:
            print(f"  {bond_type}: wartość {rate * 100:.2f}% poza zakresem — pomijam")

    return rates


def update_bond_rates_js(rates, year_month, js_file_path="src/bondRates.js"):
    """Dopisuje nowe stawki do pliku bondRates.js (pomija jeśli miesiąc już istnieje)."""
    if not rates:
        print("Brak stawek do aktualizacji!")
        return False

    print(f"\nAktualizuję {js_file_path} dla miesiąca {year_month}...")

    with open(js_file_path, "r", encoding="utf-8") as f:
        content = f.read()

    updated = False

    for bond_type, rate in rates.items():
        block_pattern = rf'({bond_type}:\s*\{{)(.*?)(\n  \}})'
        block_match = re.search(block_pattern, content, re.DOTALL)

        if not block_match:
            print(f"  {bond_type}: nie znaleziono bloku w bondRates.js")
            continue

        if year_month in block_match.group(2):
            print(f"  {bond_type}: {year_month} już istnieje, pomijam")
            continue

        new_line = f'\n    "{year_month}":{rate:.4f},'
        new_block = block_match.group(1) + block_match.group(2) + new_line + block_match.group(3)
        content = content[: block_match.start()] + new_block + content[block_match.end():]
        print(f"  ✓ {bond_type}: dodano {year_month} = {rate * 100:.2f}%")
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
    year_month = f"{now.year}-{now.month:02d}"

    # Próba 1: komunikat aktualnego miesiąca
    print(f"[1/2] Szukam komunikatu dla {year_month}:")
    rates = fetch_official_rates(now)

    # Próba 2: komunikat poprzedniego miesiąca (strona aktualnego może nie być jeszcze gotowa)
    if not rates:
        prev = now.replace(day=1) - timedelta(days=1)
        prev_ym = f"{prev.year}-{prev.month:02d}"
        print(f"\n[2/2] Strona nie gotowa — próbuję {prev_ym}:")
        rates = fetch_official_rates(prev)
        if rates:
            year_month = prev_ym

    if not rates:
        print("\n✗ Nie udało się pobrać stawek. Sprawdź dostępność obligacjeskarbowe.pl")
        sys.exit(1)

    summary = {k: f"{v * 100:.2f}%" for k, v in rates.items()}
    print(f"\nZnalezione stawki dla {year_month}: {summary}")

    updated = update_bond_rates_js(rates, year_month)

    if updated:
        print("\n✓ Aktualizacja zakończona sukcesem!")
    else:
        print("\n! Brak nowych zmian do zapisania")


if __name__ == "__main__":
    main()
