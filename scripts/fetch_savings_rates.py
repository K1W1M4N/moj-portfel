#!/usr/bin/env python3
"""
fetch_savings_rates.py
Pobiera aktualne stawki kont oszczędnościowych z Moneteo.com.
Jeśli scraping się nie powiedzie, używa Claude API jako fallback (wymaga ANTHROPIC_API_KEY).

Uruchamianie:
    python scripts/fetch_savings_rates.py

Wymaga:
    pip install requests beautifulsoup4 lxml
Opcjonalnie (Claude fallback):
    pip install anthropic
"""

import re
import json
import os
import sys
from datetime import datetime
from pathlib import Path

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("Instaluję wymagane pakiety...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests", "beautifulsoup4", "lxml", "--quiet"])
    import requests
    from bs4 import BeautifulSoup

OUTPUT_FILE = Path(__file__).parent.parent / "src" / "savingsRates.js"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
}

BANK_URLS = {
    "BOŚ Bank": "https://www.bosbank.pl/konto-oszczednosciowe",
    "BNP Paribas": "https://www.bnpparibas.pl/konto-lokacyjne",
    "Nest Bank": "https://www.nestbank.pl/konta/konto-oszczednosciowe",
    "VeloBank": "https://www.velobank.pl/konta/konto-oszczednosciowe",
    "ING Bank Śląski": "https://www.ing.pl/indywidualni/oszczedzanie/konto-oszczednosciowe",
    "mBank": "https://www.mbank.pl/indywidualny/oszczednosci/moje-cele/",
    "Alior Bank": "https://www.aliorbank.pl/indywidualni/oszczednosci/konto-oszczednosciowe.html",
    "Bank Pekao SA": "https://www.pekao.com.pl/konto-oszczednosciowe.html",
    "Bank Millennium": "https://www.bankmillennium.pl/konta/konto-oszczednosciowe-profit",
    "Toyota Bank": "https://www.toyotabank.pl/konto-oszczednosciowe",
    "UniCredit": "https://www.unicredit.pl/pl/klienci-indywidualni/oszczednosci/konto-oszczednosciowe.html",
    "Citi Handlowy": "https://www.citibank.pl/pl/konto-oszczednosciowe.html",
    "Santander Bank Polska": "https://www.santander.pl/klient-indywidualny/konta/konto-oszczednosciowe",
    "Renault Bank": "https://www.renaultbank.pl/oszczednosci/konto-oszczednosciowe",
    "Credit Agricole": "https://www.credit-agricole.pl/klienci-indywidualni/konta/konto-oszczednosciowe",
    "PKO BP": "https://www.pkobp.pl/klienci-indywidualni/konta/konto-oszczednosciowe/",
}


def parse_rate(text):
    if not text:
        return None
    text = str(text).replace(',', '.')
    match = re.search(r'(\d+\.?\d*)\s*%', text)
    if match:
        return float(match.group(1))
    return None


def parse_days(text):
    if not text:
        return None
    text = str(text).lower()
    match = re.search(r'(\d+)\s*(?:dni|d\b)', text)
    if match:
        return int(match.group(1))
    match = re.search(r'(\d+)\s*(?:mies[a-z]*|miesią[a-z]*|month)', text)
    if match:
        return int(match.group(1)) * 30
    return None


def parse_limit(text):
    if not text:
        return None
    text = str(text).lower().replace(' ', '').replace('\xa0', '').replace(',', '.')
    match = re.search(r'(\d+\.?\d*)\s*(?:tys|tyś)', text)
    if match:
        return int(float(match.group(1)) * 1000)
    match = re.search(r'(\d{4,})', text.replace('.', ''))
    if match:
        return int(match.group(1))
    return None


def normalize_bank_name(name):
    name = str(name).strip()
    mappings = {
        "bnp paribas bank polska": "BNP Paribas",
        "bnp paribas": "BNP Paribas",
        "ing bank śląski": "ING Bank Śląski",
        "ing bank slaski": "ING Bank Śląski",
        "bank millennium": "Bank Millennium",
        "millennium": "Bank Millennium",
        "bank pekao": "Bank Pekao SA",
        "pekao": "Bank Pekao SA",
        "boś bank": "BOŚ Bank",
        "bos bank": "BOŚ Bank",
        "citi handlowy": "Citi Handlowy",
        "citibank": "Citi Handlowy",
        "mbank": "mBank",
        "nest bank": "Nest Bank",
        "pko bp": "PKO BP",
        "pko bank polski": "PKO BP",
        "santander bank polska": "Santander Bank Polska",
        "santander": "Santander Bank Polska",
        "toyota bank": "Toyota Bank",
        "unicredit": "UniCredit",
        "aion bank": "UniCredit",
        "velobank": "VeloBank",
        "alior bank": "Alior Bank",
        "credit agricole": "Credit Agricole",
        "crédit agricole": "Credit Agricole",
        "renault bank": "Renault Bank",
        "volkswagen bank": "Volkswagen Bank",
        "bank pocztowy": "Bank Pocztowy",
    }
    name_lower = name.lower()
    for pattern, replacement in mappings.items():
        if pattern in name_lower:
            return replacement
    return name


def fetch_moneteo():
    """Pobiera dane z Moneteo.com — ranking kont oszczędnościowych."""
    print("📡 Pobieram dane z Moneteo.com...")
    accounts = []

    urls = [
        "https://moneteo.com/rankingi/konta-oszczednosciowe",
        "https://moneteo.com/ranking/konta-oszczednosciowe",
    ]

    html = None
    for url in urls:
        try:
            resp = requests.get(url, headers=HEADERS, timeout=30)
            if resp.status_code == 200:
                html = resp.text
                print(f"   ✅ Pobrano stronę: {url}")
                break
        except Exception as e:
            print(f"   ⚠️  {url}: {e}")

    if not html:
        print("   ❌ Nie udało się pobrać strony Moneteo")
        return accounts

    soup = BeautifulSoup(html, 'lxml')

    # Strategia 1: szukaj wierszy tabelarycznych z oprocentowaniem
    rows = (
        soup.find_all('div', class_=re.compile(r'ranking[-_]?(item|row|card|offer)', re.I)) or
        soup.find_all('article', class_=re.compile(r'ranking|offer|product', re.I)) or
        soup.find_all('tr', class_=re.compile(r'ranking|offer|product', re.I)) or
        soup.find_all('div', attrs={'data-product': True}) or
        soup.find_all('div', attrs={'data-bank': True})
    )

    print(f"   Strategia 1: {len(rows)} elementów")

    # Strategia 2: szukaj po strukturze % w tekście
    if len(rows) < 3:
        candidates = soup.find_all(string=re.compile(r'\d+[.,]\d*\s*%'))
        seen_parents = set()
        for c in candidates:
            parent = c.find_parent(['div', 'article', 'tr', 'li'])
            if parent and id(parent) not in seen_parents:
                # Sprawdź czy parent ma sensowną zawartość (nazwa banku)
                text = parent.get_text()
                if any(bank.lower() in text.lower() for bank in [
                    'bank', 'mbank', 'pko', 'ing', 'pekao', 'alior',
                    'millennium', 'santander', 'nest', 'velo', 'bnp'
                ]):
                    rows.append(parent)
                    seen_parents.add(id(parent))
        print(f"   Strategia 2: {len(rows)} elementów")

    for row in rows:
        try:
            text = row.get_text(separator=' ', strip=True)

            # Znajdź nazwę banku
            bank_name = None
            img = row.find('img', alt=True)
            if img:
                bank_name = normalize_bank_name(img['alt'])

            if not bank_name:
                for tag in row.find_all(['span', 'div', 'h2', 'h3', 'strong', 'a']):
                    t = tag.get_text(strip=True)
                    if 5 < len(t) < 60 and any(w in t.lower() for w in [
                        'bank', 'konto', 'mbank', 'pko', 'ing', 'alior',
                        'velo', 'nest', 'bnp', 'pekao', 'santander', 'millennium'
                    ]):
                        bank_name = normalize_bank_name(t)
                        break

            if not bank_name:
                continue

            # Znajdź wszystkie liczby %
            rates = [parse_rate(m) for m in re.findall(r'\d+[.,]?\d*\s*%', text)]
            rates = [r for r in rates if r and 0.1 < r < 25]

            if not rates:
                continue

            best_rate = max(rates)
            days = parse_days(text)
            limit = parse_limit(text)
            requires_ror = any(w in text.lower() for w in ['konto osobiste', 'ror', 'rachunek osobisty'])

            # Wyodrębnij nazwę produktu
            product_name = None
            for tag in row.find_all(['h2', 'h3', 'a', 'strong']):
                t = tag.get_text(strip=True)
                if 10 < len(t) < 80 and ('konto' in t.lower() or 'lokata' in t.lower() or 'oszczędn' in t.lower()):
                    product_name = t
                    break

            accounts.append({
                'bank': bank_name,
                'name': product_name or f"Konto Oszczędnościowe {bank_name}",
                'ratePromo': best_rate if days else None,
                'rateStandard': min(rates) if len(rates) > 1 else (best_rate if not days else 1.0),
                'promoDays': days,
                'promoLimit': limit,
                'promoConditions': None,
                'promoConditionsList': [],
                'requiresROR': requires_ror,
                'url': BANK_URLS.get(bank_name, ''),
            })

        except Exception as e:
            print(f"   ⚠️  Błąd parsowania: {e}")

    print(f"   📊 Wynik: {len(accounts)} kont z Moneteo")
    return accounts


def fetch_with_claude(anthropic_key):
    """
    Używa Claude API do inteligentnego wyodrębniania danych z Moneteo.com.
    Fallback gdy zwykły scraping się nie powiedzie.
    """
    print("🤖 Używam Claude API do wyodrębnienia danych...")

    try:
        import anthropic
    except ImportError:
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "anthropic", "--quiet"])
        import anthropic

    try:
        url = "https://moneteo.com/rankingi/konta-oszczednosciowe"
        resp = requests.get(url, headers=HEADERS, timeout=30)
        # Wyczyść HTML — usuń skrypty, style, zachowaj tekst
        soup = BeautifulSoup(resp.text, 'lxml')
        for tag in soup(['script', 'style', 'nav', 'footer', 'header']):
            tag.decompose()
        clean_text = soup.get_text(separator='\n', strip=True)
        # Ogranicz do 30k znaków
        clean_text = clean_text[:30000]
    except Exception as e:
        print(f"   ❌ Błąd pobierania strony dla Claude: {e}")
        return []

    client = anthropic.Anthropic(api_key=anthropic_key)

    prompt = f"""Poniżej jest tekst ze strony Moneteo.com z rankingiem kont oszczędnościowych.
Wyodrębnij listę ofert kont oszczędnościowych i zwróć TYLKO tablicę JSON (bez żadnego innego tekstu).

Każdy obiekt w tablicy musi mieć pola:
- bank: string (nazwa banku, np. "BNP Paribas")
- name: string (nazwa produktu)
- rateStandard: number (oprocentowanie standardowe po promocji, %)
- ratePromo: number | null (oprocentowanie promocyjne, %)
- promoLimit: number | null (maksymalna kwota objęta promocją w PLN, np. 50000)
- promoDays: number | null (liczba dni promocji)
- promoConditions: string | null (krótki opis warunków)
- requiresROR: boolean (czy wymaga konta osobistego)

Tekst strony:
{clean_text}"""

    try:
        message = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}]
        )
        response_text = message.content[0].text

        # Znajdź tablicę JSON
        match = re.search(r'\[[\s\S]*\]', response_text)
        if not match:
            print("   ❌ Claude nie zwrócił prawidłowego JSON")
            return []

        raw = json.loads(match.group())
        accounts = []
        for item in raw:
            bank = normalize_bank_name(item.get('bank', ''))
            accounts.append({
                'bank': bank,
                'name': item.get('name', f"Konto Oszczędnościowe {bank}"),
                'rateStandard': item.get('rateStandard'),
                'ratePromo': item.get('ratePromo'),
                'promoLimit': item.get('promoLimit'),
                'promoDays': item.get('promoDays'),
                'promoConditions': item.get('promoConditions'),
                'promoConditionsList': [],
                'requiresROR': item.get('requiresROR', True),
                'url': BANK_URLS.get(bank, ''),
            })

        print(f"   ✅ Claude wyodrębnił {len(accounts)} ofert")
        return accounts

    except Exception as e:
        print(f"   ❌ Błąd Claude API: {e}")
        return []


def get_hardcoded_rates():
    """Ostatnia ręcznie zweryfikowana lista jako bezpieczny fallback."""
    print("📋 Używam ostatnio zweryfikowanych stawek jako fallback...")
    return [
        {
            "bank": "BOŚ Bank", "name": "Konto Oszczędnościowe Cyfrowy Zysk",
            "rateStandard": 2.0, "ratePromo": 7.0, "promoLimit": 15000, "promoDays": None,
            "promoConditions": "Oferta dla nowych klientów, bez konta osobistego",
            "promoConditionsList": ["Tylko dla nowych klientów BOŚ Banku", "Nie wymaga posiadania konta osobistego", "Limit środków objętych promocją: 15 000 zł"],
            "requiresROR": False, "url": "https://www.bosbank.pl/konto-oszczednosciowe",
        },
        {
            "bank": "BNP Paribas", "name": "Konto Lokacyjne",
            "rateStandard": 0.5, "ratePromo": 7.0, "promoLimit": 50000, "promoDays": None,
            "promoConditions": "Nowi klienci, konto osobiste, 4 transakcje + wpływy 1000 zł",
            "promoConditionsList": ["Tylko dla nowych klientów BNP Paribas", "Wymagane konto osobiste", "Min. 4 transakcje kartą/BLIK miesięcznie", "Wpływ wynagrodzenia min. 1 000 zł/mies.", "Limit: 50 000 zł"],
            "requiresROR": True, "url": "https://www.bnpparibas.pl/konto-lokacyjne",
        },
        {
            "bank": "Nest Bank", "name": "Nest Konto Oszczędnościowe",
            "rateStandard": 2.0, "ratePromo": 6.6, "promoLimit": 25000, "promoDays": 90,
            "promoConditions": "Nowi klienci, wpływ 2000 zł lub 10 transakcji",
            "promoConditionsList": ["Tylko dla nowych klientów Nest Banku", "Wymagane konto osobiste Nest Konto", "Wpływ min. 2 000 zł/mies. LUB min. 10 transakcji kartą", "Okres promocji: 90 dni", "Limit: 25 000 zł"],
            "requiresROR": True, "url": "https://www.nestbank.pl/konta/konto-oszczednosciowe",
        },
        {
            "bank": "VeloBank", "name": "Elastyczne Konto Oszczędnościowe",
            "rateStandard": 1.0, "ratePromo": 6.0, "promoLimit": 50000, "promoDays": 92,
            "promoConditions": "Nowi klienci, 5 transakcji/mies.",
            "promoConditionsList": ["Tylko dla nowych klientów VeloBanku", "Wymagane konto osobiste VeloKonto", "Min. 5 transakcji kartą/BLIK miesięcznie", "Okres promocji: 92 dni", "Limit: 50 000 zł"],
            "requiresROR": True, "url": "https://www.velobank.pl/konta/konto-oszczednosciowe",
        },
        {
            "bank": "ING Bank Śląski", "name": "Otwarte Konto Oszczędnościowe",
            "rateStandard": 0.8, "ratePromo": 5.5, "promoLimit": 400000, "promoDays": 90,
            "promoConditions": "Bonus na start, 3 logowania + 15 transakcji",
            "promoConditionsList": ["Oferta dla nowych klientów ING (Bonus na start)", "Wymagane konto osobiste ING Direct", "Min. 3 logowania do bankowości internetowej/mies.", "Min. 15 transakcji kartą/BLIK miesięcznie", "Okres promocji: 90 dni", "Limit: 400 000 zł"],
            "requiresROR": True, "url": "https://www.ing.pl/indywidualni/oszczedzanie/konto-oszczednosciowe",
        },
        {
            "bank": "mBank", "name": "Moje Cele",
            "rateStandard": 0.5, "ratePromo": 5.3, "promoLimit": 50000, "promoDays": 90,
            "promoConditions": "Nowi klienci mKonto Intensive",
            "promoConditionsList": ["Tylko dla nowych klientów mBanku", "Wymagane konto mKonto Intensive", "Okres promocji: 90 dni", "Limit: 50 000 zł"],
            "requiresROR": True, "url": "https://www.mbank.pl/indywidualny/oszczednosci/moje-cele/",
        },
        {
            "bank": "Alior Bank", "name": "Konto Oszczędnościowe na Start",
            "rateStandard": 1.0, "ratePromo": 5.2, "promoLimit": 30000, "promoDays": 120,
            "promoConditions": "Nowi klienci, transakcje 500 zł/mies.",
            "promoConditionsList": ["Tylko dla nowych klientów Alior Banku", "Wymagane konto osobiste", "Transakcje kartą na min. 500 zł/mies.", "Okres promocji: 120 dni", "Limit: 30 000 zł"],
            "requiresROR": True, "url": "https://www.aliorbank.pl/indywidualni/oszczednosci/konto-oszczednosciowe.html",
        },
        {
            "bank": "Bank Pekao SA", "name": "Konto Oszczędnościowe",
            "rateStandard": 0.5, "ratePromo": 5.0, "promoLimit": 100000, "promoDays": 92,
            "promoConditions": "Nowi klienci lub niskie saldo",
            "promoConditionsList": ["Dla nowych klientów lub klientów z niskim saldem", "Wymagane konto osobiste Pekao", "Okres promocji: 92 dni", "Limit: 100 000 zł"],
            "requiresROR": True, "url": "https://www.pekao.com.pl/konto-oszczednosciowe.html",
        },
        {
            "bank": "Bank Millennium", "name": "Konto Oszczędnościowe Profit",
            "rateStandard": 0.75, "ratePromo": 5.0, "promoLimit": 200000, "promoDays": 91,
            "promoConditions": "Nowe środki, 5 transakcji/mies.",
            "promoConditionsList": ["Dotyczy nowych środków (ponad dotychczasowe saldo)", "Wymagane konto osobiste Millennium 360°", "Min. 5 transakcji kartą/BLIK miesięcznie", "Okres promocji: 91 dni", "Limit: 200 000 zł"],
            "requiresROR": True, "url": "https://www.bankmillennium.pl/konta/konto-oszczednosciowe-profit",
        },
        {
            "bank": "Toyota Bank", "name": "Konto Oszczędnościowe",
            "rateStandard": 5.0, "ratePromo": None, "promoLimit": None, "promoDays": None,
            "promoConditions": "Dla kwot 50-400 tys. zł",
            "promoConditionsList": ["Stała stawka 5% bez okresu promocyjnego", "Minimalne saldo: 50 000 zł", "Maksymalne saldo objęte stawką: 400 000 zł"],
            "requiresROR": True, "url": "https://www.toyotabank.pl/konto-oszczednosciowe",
        },
        {
            "bank": "UniCredit", "name": "Konto Oszczędnościowe",
            "rateStandard": 4.5, "ratePromo": None, "promoLimit": None, "promoDays": None,
            "promoConditions": None,
            "promoConditionsList": ["Stała stawka 4,5% bez okresu promocyjnego", "Brak wymogu konta osobistego"],
            "requiresROR": False, "url": "https://www.unicredit.pl/pl/klienci-indywidualni/oszczednosci/konto-oszczednosciowe.html",
        },
        {
            "bank": "ING Bank Śląski", "name": "Smart Saver",
            "rateStandard": 4.3, "ratePromo": None, "promoLimit": None, "promoDays": None,
            "promoConditions": "Bez warunków",
            "promoConditionsList": ["Stała stawka 4,3% bez dodatkowych warunków", "Brak wymogu konta osobistego"],
            "requiresROR": False, "url": "https://www.ing.pl/indywidualni/oszczedzanie/smart-saver",
        },
        {
            "bank": "Citi Handlowy", "name": "Konto Oszczędnościowe",
            "rateStandard": 0.8, "ratePromo": 4.8, "promoLimit": None, "promoDays": 180,
            "promoConditions": "Citigold, min. 400 tys. zł, 3 transakcje 500 zł/mies.",
            "promoConditionsList": ["Wymaga statusu Citigold (aktywa min. 400 000 zł)", "Min. 3 transakcje po min. 500 zł/mies.", "Okres promocji: 180 dni"],
            "requiresROR": True, "url": "https://www.citibank.pl/pl/konto-oszczednosciowe.html",
        },
        {
            "bank": "Alior Bank", "name": "Konto Mega Oszczędnościowe",
            "rateStandard": 1.0, "ratePromo": 4.8, "promoLimit": 200000, "promoDays": 90,
            "promoConditions": "Nowe środki, transakcje 500 zł/mies.",
            "promoConditionsList": ["Dotyczy nowych środków", "Transakcje kartą na min. 500 zł/mies.", "Okres promocji: 90 dni", "Limit: 200 000 zł"],
            "requiresROR": True, "url": "https://www.aliorbank.pl/indywidualni/oszczednosci/konto-mega-oszczednosciowe.html",
        },
        {
            "bank": "Santander Bank Polska", "name": "Konto Select Oszczędnościowe",
            "rateStandard": 1.0, "ratePromo": 4.0, "promoLimit": None, "promoDays": None,
            "promoConditions": "Nowe środki",
            "promoConditionsList": ["Dotyczy nowych środków", "Wymagane konto osobiste Santander Select"],
            "requiresROR": True, "url": "https://www.santander.pl/klient-indywidualny/konta/konto-oszczednosciowe",
        },
        {
            "bank": "Renault Bank", "name": "Konto Oszczędnościowe",
            "rateStandard": 4.0, "ratePromo": None, "promoLimit": None, "promoDays": None,
            "promoConditions": None,
            "promoConditionsList": ["Stała stawka 4% bez okresu promocyjnego", "Brak wymogu konta osobistego"],
            "requiresROR": False, "url": "https://www.renaultbank.pl/oszczednosci/konto-oszczednosciowe",
        },
        {
            "bank": "Credit Agricole", "name": "Konto Oszczędnościowe",
            "rateStandard": 0.5, "ratePromo": 3.5, "promoLimit": 100000, "promoDays": 90,
            "promoConditions": "Nowi klienci",
            "promoConditionsList": ["Tylko dla nowych klientów Credit Agricole", "Wymagane konto osobiste CA", "Okres promocji: 90 dni", "Limit: 100 000 zł"],
            "requiresROR": True, "url": "https://www.credit-agricole.pl/klienci-indywidualni/konta/konto-oszczednosciowe",
        },
        {
            "bank": "Nest Bank", "name": "Nest Konto Twoje Cele",
            "rateStandard": 2.0, "ratePromo": 5.0, "promoLimit": 20000, "promoDays": 90,
            "promoConditions": None,
            "promoConditionsList": ["Wymagane konto osobiste Nest Konto", "Okres promocji: 90 dni", "Limit: 20 000 zł"],
            "requiresROR": True, "url": "https://www.nestbank.pl/konta/konto-twoje-cele",
        },
        {
            "bank": "VeloBank", "name": "VeloSkarbonka",
            "rateStandard": 1.83, "ratePromo": None, "promoLimit": None, "promoDays": None,
            "promoConditions": None,
            "promoConditionsList": ["Stała stawka 1,83%", "Brak wymogu konta osobistego"],
            "requiresROR": False, "url": "https://www.velobank.pl/konta/veloskarbonka",
        },
        {
            "bank": "PKO BP", "name": "Konto Oszczędnościowe",
            "rateStandard": 0.5, "ratePromo": None, "promoLimit": None, "promoDays": None,
            "promoConditions": None,
            "promoConditionsList": ["Wymagane konto osobiste PKO BP", "Stawka standardowa 0,5%"],
            "requiresROR": True, "url": "https://www.pkobp.pl/klienci-indywidualni/konta/konto-oszczednosciowe/",
        },
        {
            "bank": "mBank", "name": "eKonto Oszczędnościowe",
            "rateStandard": 0.5, "ratePromo": None, "promoLimit": None, "promoDays": None,
            "promoConditions": None,
            "promoConditionsList": ["Wymagane konto osobiste mKonto", "Stawka standardowa 0,5%"],
            "requiresROR": True, "url": "https://www.mbank.pl/indywidualny/oszczednosci/ekonto-oszczednosciowe/",
        },
    ]


def merge_accounts(all_accounts):
    merged = {}
    for acc in all_accounts:
        key = f"{acc['bank'].lower()}|{acc.get('name', '')[:25].lower()}"
        if key not in merged:
            merged[key] = acc
        else:
            existing = merged[key]
            if acc.get('ratePromo') and (not existing.get('ratePromo') or acc['ratePromo'] > existing['ratePromo']):
                existing['ratePromo'] = acc['ratePromo']
            if acc.get('rateStandard') and (not existing.get('rateStandard') or acc['rateStandard'] > existing['rateStandard']):
                existing['rateStandard'] = acc['rateStandard']
            for field in ['promoDays', 'promoLimit', 'promoConditions', 'promoConditionsList', 'url']:
                if acc.get(field) and not existing.get(field):
                    existing[field] = acc[field]
    return list(merged.values())


def generate_js_file(accounts, output_path):
    today = datetime.now().strftime("%Y-%m")
    updated_at = datetime.now().strftime("%Y-%m-%d %H:%M")

    accounts_sorted = sorted(
        accounts,
        key=lambda x: (x.get('ratePromo') or x.get('rateStandard') or 0),
        reverse=True
    )

    def js_val(v):
        if v is None:
            return 'null'
        if isinstance(v, bool):
            return 'true' if v else 'false'
        if isinstance(v, (int, float)):
            return str(v)
        if isinstance(v, list):
            items = ', '.join(json.dumps(i, ensure_ascii=False) for i in v)
            return f'[{items}]'
        return json.dumps(v, ensure_ascii=False)

    lines = [
        '// savingsRates.js',
        f'// Automatycznie generowane przez fetch_savings_rates.py',
        f'// Ostatnia aktualizacja: {updated_at}',
        '// Źródła: Moneteo.com, oficjalne strony banków',
        '',
        'export const SAVINGS_RATES_DB = {',
        f'  lastUpdated: "{today}",',
        '  accounts: [',
    ]

    for acc in accounts_sorted:
        lines.append('    {')
        lines.append(f'      bank: {js_val(acc.get("bank"))},')
        lines.append(f'      name: {js_val(acc.get("name", "Konto Oszczędnościowe"))},')
        lines.append(f'      rateStandard: {js_val(acc.get("rateStandard"))},')
        lines.append(f'      ratePromo: {js_val(acc.get("ratePromo"))},')
        lines.append(f'      promoLimit: {js_val(acc.get("promoLimit"))},')
        lines.append(f'      promoDays: {js_val(acc.get("promoDays"))},')
        lines.append(f'      promoConditions: {js_val(acc.get("promoConditions"))},')
        lines.append(f'      promoConditionsList: {js_val(acc.get("promoConditionsList", []))},')
        lines.append(f'      requiresROR: {js_val(acc.get("requiresROR", True))},')
        lines.append(f'      url: {js_val(acc.get("url", ""))},')
        lines.append('    },')

    lines += ['  ],', '};', '']

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text('\n'.join(lines), encoding='utf-8')
    print(f"✅ Zapisano {len(accounts_sorted)} kont do {output_path}")


def main():
    print("=" * 60)
    print("🏦 Aktualizacja stawek kont oszczędnościowych")
    print(f"   {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print("=" * 60)
    print()

    accounts = []

    # 1. Spróbuj scraper Moneteo
    scraped = fetch_moneteo()
    if len(scraped) >= 5:
        accounts = scraped
        print(f"✅ Scraper Moneteo zwrócił {len(scraped)} ofert")
    else:
        print(f"⚠️  Scraper Moneteo zwrócił tylko {len(scraped)} ofert")

        # 2. Fallback: Claude API
        anthropic_key = os.environ.get('ANTHROPIC_API_KEY')
        if anthropic_key:
            claude_accounts = fetch_with_claude(anthropic_key)
            if len(claude_accounts) >= 5:
                accounts = claude_accounts
                print(f"✅ Claude API zwrócił {len(claude_accounts)} ofert")
            else:
                print("⚠️  Claude API też nie zwrócił wystarczająco danych")

    # 3. Zawsze scal z hardcoded (zachowaj promoConditionsList i url których scraper nie ma)
    hardcoded = get_hardcoded_rates()
    all_accounts = accounts + hardcoded
    merged = merge_accounts(all_accounts)

    print()
    print(f"📊 Łącznie po scaleniu: {len(merged)} unikalnych kont")
    print()

    generate_js_file(merged, OUTPUT_FILE)

    print()
    print("🎉 Gotowe!")


if __name__ == "__main__":
    main()
