#!/usr/bin/env python3
"""
fetch_savings_rates.py
Pobiera aktualne stawki kont oszczędnościowych z wielu źródeł.

Źródła:
  1. Moneteo.com  — rankingi/konta-oszczednosciowe
  2. Bankier.pl   — smart/konta-oszczednosciowe
  3. Comperia.pl  — konta-oszczednosciowe
  4. Claude API   — fallback inteligentny (wymaga ANTHROPIC_API_KEY)
  5. Hardcoded    — ostatni znany stan jako bezpieczny fallback

Uruchamianie:
    python scripts/fetch_savings_rates.py
"""

import re
import json
import os
import sys
from datetime import datetime, date
from pathlib import Path

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests", "beautifulsoup4", "lxml", "--quiet"])
    import requests
    from bs4 import BeautifulSoup

OUTPUT_FILE = Path(__file__).parent.parent / "src" / "savingsRates.js"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.8",
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
    "Volkswagen Bank": "https://www.vwbank.pl/konto-oszczednosciowe",
    "Bank Pocztowy": "https://www.pocztowy.pl/konta/konto-oszczednosciowe/",
    "Raiffeisen Digital Bank": "https://www.raiffeisen.pl/",
}


# ─── Parsery ─────────────────────────────────────────────────────────────────

def parse_rate(text):
    if not text:
        return None
    text = str(text).replace(',', '.')
    match = re.search(r'(\d+\.?\d*)\s*%', text)
    if match:
        v = float(match.group(1))
        return v if 0.1 < v < 25 else None
    return None


def parse_days(text):
    if not text:
        return None
    text = str(text).lower()
    m = re.search(r'(\d+)\s*(?:dni|d\b)', text)
    if m:
        return int(m.group(1))
    m = re.search(r'(\d+)\s*(?:mies[a-z]*|miesią[a-z]*|month)', text)
    if m:
        return int(m.group(1)) * 30
    return None


def parse_limit(text):
    if not text:
        return None
    text = str(text).lower().replace(' ', '').replace('\xa0', '').replace(',', '.')
    m = re.search(r'(\d+\.?\d*)\s*(?:tys|tyś)', text)
    if m:
        return int(float(m.group(1)) * 1000)
    m = re.search(r'(\d{4,})', text.replace('.', ''))
    if m:
        return int(m.group(1))
    return None


def parse_end_date(text):
    """Wyodrębnij datę zakończenia promocji, np. 'do 29.04.2026' -> '2026-04-29'"""
    if not text:
        return None
    text = str(text)
    # Format DD.MM.YYYY
    m = re.search(r'(\d{1,2})[.\-/](\d{1,2})[.\-/](20\d{2})', text)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= d <= 31 and 1 <= mo <= 12:
            return f"{y}-{mo:02d}-{d:02d}"
    # Format YYYY-MM-DD
    m = re.search(r'(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})', text)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
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
        "vw bank": "Volkswagen Bank",
        "bank pocztowy": "Bank Pocztowy",
        "raiffeisen": "Raiffeisen Digital Bank",
    }
    nl = name.lower()
    for pattern, replacement in mappings.items():
        if pattern in nl:
            return replacement
    return name


def fetch_page(url):
    try:
        r = requests.get(url, headers=HEADERS, timeout=25)
        if r.status_code == 200:
            return r.text
    except Exception as e:
        print(f"   ⚠️  {url}: {e}")
    return None


def extract_offers_from_soup(soup, source_name):
    """Generyczny ekstraktor ofert ze struktury BeautifulSoup."""
    accounts = []

    # Strategia 1: elementy z atrybutem data-*
    rows = (
        soup.find_all('div', attrs={'data-product': True}) or
        soup.find_all('div', attrs={'data-bank': True}) or
        soup.find_all('article', attrs={'data-id': True})
    )

    # Strategia 2: klasy rankingowe
    if len(rows) < 3:
        rows = (
            soup.find_all('div', class_=re.compile(r'ranking[-_]?(item|row|card|offer|product)', re.I)) or
            soup.find_all('article', class_=re.compile(r'ranking|offer|product|card', re.I)) or
            soup.find_all('tr', class_=re.compile(r'ranking|offer|product', re.I))
        )

    # Strategia 3: szukaj bloków zawierających % + nazwę banku
    if len(rows) < 3:
        seen = set()
        for c in soup.find_all(string=re.compile(r'\d+[.,]\d*\s*%')):
            parent = c.find_parent(['div', 'article', 'tr', 'li', 'section'])
            if parent and id(parent) not in seen:
                text = parent.get_text()
                if any(b in text.lower() for b in ['bank', 'mbank', 'pko', 'ing', 'pekao',
                        'alior', 'millennium', 'santander', 'nest', 'velo', 'bnp', 'konto']):
                    rows.append(parent)
                    seen.add(id(parent))

    print(f"   [{source_name}] {len(rows)} potencjalnych ofert")

    for row in rows:
        try:
            text = row.get_text(separator=' ', strip=True)

            # Nazwa banku
            bank_name = None
            img = row.find('img', alt=True)
            if img:
                alt = img.get('alt', '')
                if any(w in alt.lower() for w in ['bank', 'mbank', 'pko', 'ing', 'alior',
                        'velo', 'nest', 'bnp', 'pekao', 'santander', 'millennium', 'credit']):
                    bank_name = normalize_bank_name(alt)

            if not bank_name:
                for tag in row.find_all(['span', 'div', 'h2', 'h3', 'strong', 'a', 'td']):
                    t = tag.get_text(strip=True)
                    if 3 < len(t) < 50 and any(w in t.lower() for w in [
                        'bank', 'mbank', 'pko', 'ing', 'alior', 'velo',
                        'nest', 'bnp', 'pekao', 'santander', 'millennium', 'toyota',
                        'credit', 'citi', 'renault', 'volkswagen', 'pocztowy'
                    ]):
                        bank_name = normalize_bank_name(t)
                        break

            if not bank_name:
                continue

            # Wszystkie stawki %
            rates = [parse_rate(m) for m in re.findall(r'\d+[.,]?\d*\s*%', text)]
            rates = [r for r in rates if r]
            if not rates:
                continue

            best_rate = max(rates)
            std_rate = min(rates) if len(rates) > 1 else None
            days = parse_days(text)
            limit = parse_limit(text)
            end_date = parse_end_date(text)
            requires_ror = any(w in text.lower() for w in [
                'konto osobiste', 'ror', 'rachunek osobisty', 'rachunek bieżący'
            ])

            # Nazwa produktu
            product_name = None
            for tag in row.find_all(['h2', 'h3', 'a', 'strong', 'span']):
                t = tag.get_text(strip=True)
                if 10 < len(t) < 80 and any(w in t.lower() for w in
                        ['konto', 'lokata', 'oszczędn', 'oszczed', 'profit', 'cele', 'skarbonka']):
                    product_name = t
                    break

            accounts.append({
                'bank': bank_name,
                'name': product_name or f"Konto Oszczędnościowe {bank_name}",
                'ratePromo': best_rate if days or end_date else None,
                'rateStandard': std_rate if (days or end_date) and std_rate else (best_rate if not days else 1.0),
                'promoDays': days,
                'promoLimit': limit,
                'promoEndDate': end_date,
                'promoConditions': None,
                'promoConditionsList': [],
                'requiresROR': requires_ror,
                'url': BANK_URLS.get(bank_name, ''),
                '_source': source_name,
            })

        except Exception as e:
            print(f"   ⚠️  Błąd parsowania: {e}")

    return accounts


# ─── Źródła ──────────────────────────────────────────────────────────────────

def fetch_moneteo():
    print("📡 Moneteo.com...")
    for url in [
        "https://moneteo.com/rankingi/konta-oszczednosciowe",
        "https://moneteo.com/ranking/konta-oszczednosciowe",
    ]:
        html = fetch_page(url)
        if html:
            soup = BeautifulSoup(html, 'lxml')
            results = extract_offers_from_soup(soup, "moneteo")
            if len(results) >= 3:
                return results
    return []


def fetch_bankier():
    print("📡 Bankier.pl...")
    html = fetch_page("https://www.bankier.pl/smart/konta-oszczednosciowe")
    if not html:
        return []
    soup = BeautifulSoup(html, 'lxml')
    return extract_offers_from_soup(soup, "bankier")


def fetch_comperia():
    print("📡 Comperia.pl...")
    for url in [
        "https://www.comperia.pl/konta-oszczednosciowe",
        "https://comperia.pl/konta-oszczednosciowe/ranking",
    ]:
        html = fetch_page(url)
        if html:
            soup = BeautifulSoup(html, 'lxml')
            results = extract_offers_from_soup(soup, "comperia")
            if len(results) >= 3:
                return results
    return []


def fetch_with_claude(anthropic_key):
    """Fallback: Claude API parsuje tekst strony Moneteo."""
    print("🤖 Claude API fallback...")
    try:
        import anthropic
    except ImportError:
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "anthropic", "--quiet"])
        import anthropic

    html = fetch_page("https://moneteo.com/rankingi/konta-oszczednosciowe")
    if not html:
        return []

    soup = BeautifulSoup(html, 'lxml')
    for tag in soup(['script', 'style', 'nav', 'footer', 'header']):
        tag.decompose()
    clean_text = soup.get_text(separator='\n', strip=True)[:30000]

    client = anthropic.Anthropic(api_key=anthropic_key)
    prompt = f"""Wyodrębnij oferty kont oszczędnościowych z poniższego tekstu ze strony Moneteo.com.
Zwróć TYLKO tablicę JSON bez żadnego dodatkowego tekstu.

Pola każdego obiektu:
- bank: string
- name: string (nazwa produktu)
- rateStandard: number (oprocentowanie standardowe %)
- ratePromo: number | null (oprocentowanie promocyjne %)
- promoLimit: number | null (limit kwoty w PLN)
- promoDays: number | null (liczba dni promocji)
- promoEndDate: string | null (data końca kampanii YYYY-MM-DD, jeśli podana)
- promoConditions: string | null
- requiresROR: boolean

Tekst:
{clean_text}"""

    try:
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}]
        )
        text = msg.content[0].text
        match = re.search(r'\[[\s\S]*\]', text)
        if not match:
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
                'promoEndDate': item.get('promoEndDate'),
                'promoConditions': item.get('promoConditions'),
                'promoConditionsList': [],
                'requiresROR': item.get('requiresROR', True),
                'url': BANK_URLS.get(bank, ''),
                '_source': 'claude',
            })
        print(f"   ✅ Claude wyodrębnił {len(accounts)} ofert")
        return accounts
    except Exception as e:
        print(f"   ❌ Błąd Claude API: {e}")
        return []


# ─── Hardcoded fallback ───────────────────────────────────────────────────────

def get_hardcoded_rates():
    print("📋 Hardcoded fallback (ostatnio zweryfikowane)...")
    return [
        {"bank": "BOŚ Bank", "name": "Konto Oszczędnościowe Cyfrowy Zysk",
         "rateStandard": 2.0, "ratePromo": 7.0, "promoLimit": 15000, "promoDays": None,
         "promoEndDate": "2026-04-29",
         "promoConditions": "Oferta dla nowych klientów, bez konta osobistego",
         "promoConditionsList": ["Tylko dla nowych klientów BOŚ Banku", "Nie wymaga posiadania konta osobistego", "Limit środków objętych promocją: 15 000 zł", "Oferta ważna do 29.04.2026"],
         "requiresROR": False, "url": "https://www.bosbank.pl/konto-oszczednosciowe"},
        {"bank": "BNP Paribas", "name": "Konto Lokacyjne",
         "rateStandard": 0.5, "ratePromo": 7.0, "promoLimit": 50000, "promoDays": None,
         "promoEndDate": "2026-04-30",
         "promoConditions": "Nowi klienci, konto osobiste, 4 transakcje + wpływy 1000 zł",
         "promoConditionsList": ["Tylko dla nowych klientów BNP Paribas", "Wymagane konto osobiste", "Min. 4 transakcje kartą/BLIK miesięcznie", "Wpływ wynagrodzenia min. 1 000 zł/mies.", "Limit: 50 000 zł", "Oferta ważna do 30.04.2026"],
         "requiresROR": True, "url": "https://www.bnpparibas.pl/konto-lokacyjne"},
        {"bank": "Nest Bank", "name": "Nest Konto Oszczędnościowe",
         "rateStandard": 2.0, "ratePromo": 6.6, "promoLimit": 25000, "promoDays": 90,
         "promoEndDate": None,
         "promoConditions": "Nowi klienci, wpływ 2000 zł lub 10 transakcji",
         "promoConditionsList": ["Tylko dla nowych klientów Nest Banku", "Wymagane konto osobiste Nest Konto", "Wpływ min. 2 000 zł/mies. LUB min. 10 transakcji kartą", "Okres promocji: 90 dni", "Limit: 25 000 zł"],
         "requiresROR": True, "url": "https://www.nestbank.pl/konta/konto-oszczednosciowe"},
        {"bank": "VeloBank", "name": "Elastyczne Konto Oszczędnościowe",
         "rateStandard": 1.0, "ratePromo": 6.0, "promoLimit": 50000, "promoDays": 92,
         "promoEndDate": None,
         "promoConditions": "Nowi klienci, 5 transakcji/mies.",
         "promoConditionsList": ["Tylko dla nowych klientów VeloBanku", "Wymagane konto osobiste VeloKonto", "Min. 5 transakcji kartą/BLIK miesięcznie", "Okres promocji: 92 dni", "Limit: 50 000 zł"],
         "requiresROR": True, "url": "https://www.velobank.pl/konta/konto-oszczednosciowe"},
        {"bank": "ING Bank Śląski", "name": "Otwarte Konto Oszczędnościowe",
         "rateStandard": 0.8, "ratePromo": 5.5, "promoLimit": 400000, "promoDays": 90,
         "promoEndDate": None,
         "promoConditions": "Bonus na start, 3 logowania + 15 transakcji",
         "promoConditionsList": ["Oferta dla nowych klientów ING (Bonus na start)", "Wymagane konto osobiste ING Direct", "Min. 3 logowania do bankowości internetowej/mies.", "Min. 15 transakcji kartą/BLIK miesięcznie", "Okres promocji: 90 dni", "Limit: 400 000 zł"],
         "requiresROR": True, "url": "https://www.ing.pl/indywidualni/oszczedzanie/konto-oszczednosciowe"},
        {"bank": "mBank", "name": "Moje Cele",
         "rateStandard": 0.5, "ratePromo": 5.3, "promoLimit": 50000, "promoDays": 90,
         "promoEndDate": None,
         "promoConditions": "Nowi klienci mKonto Intensive",
         "promoConditionsList": ["Tylko dla nowych klientów mBanku", "Wymagane konto mKonto Intensive", "Okres promocji: 90 dni", "Limit: 50 000 zł"],
         "requiresROR": True, "url": "https://www.mbank.pl/indywidualny/oszczednosci/moje-cele/"},
        {"bank": "Alior Bank", "name": "Konto Oszczędnościowe na Start",
         "rateStandard": 1.0, "ratePromo": 5.2, "promoLimit": 30000, "promoDays": 120,
         "promoEndDate": None,
         "promoConditions": "Nowi klienci, transakcje 500 zł/mies.",
         "promoConditionsList": ["Tylko dla nowych klientów Alior Banku", "Wymagane konto osobiste", "Transakcje kartą na min. 500 zł/mies.", "Okres promocji: 120 dni", "Limit: 30 000 zł"],
         "requiresROR": True, "url": "https://www.aliorbank.pl/indywidualni/oszczednosci/konto-oszczednosciowe.html"},
        {"bank": "Bank Pekao SA", "name": "Konto Oszczędnościowe",
         "rateStandard": 0.5, "ratePromo": 5.0, "promoLimit": 100000, "promoDays": 92,
         "promoEndDate": None,
         "promoConditions": "Nowi klienci lub niskie saldo",
         "promoConditionsList": ["Dla nowych klientów lub klientów z niskim saldem", "Wymagane konto osobiste Pekao", "Okres promocji: 92 dni", "Limit: 100 000 zł"],
         "requiresROR": True, "url": "https://www.pekao.com.pl/konto-oszczednosciowe.html"},
        {"bank": "Bank Millennium", "name": "Konto Oszczędnościowe Profit",
         "rateStandard": 0.75, "ratePromo": 5.0, "promoLimit": 200000, "promoDays": 91,
         "promoEndDate": None,
         "promoConditions": "Nowe środki, 5 transakcji/mies.",
         "promoConditionsList": ["Dotyczy nowych środków (ponad dotychczasowe saldo)", "Wymagane konto osobiste Millennium 360°", "Min. 5 transakcji kartą/BLIK miesięcznie", "Okres promocji: 91 dni", "Limit: 200 000 zł"],
         "requiresROR": True, "url": "https://www.bankmillennium.pl/konta/konto-oszczednosciowe-profit"},
        {"bank": "Toyota Bank", "name": "Konto Oszczędnościowe",
         "rateStandard": 5.0, "ratePromo": None, "promoLimit": None, "promoDays": None,
         "promoEndDate": None,
         "promoConditions": "Dla kwot 50-400 tys. zł",
         "promoConditionsList": ["Stała stawka 5% bez okresu promocyjnego", "Minimalne saldo: 50 000 zł", "Maksymalne saldo objęte stawką: 400 000 zł"],
         "requiresROR": True, "url": "https://www.toyotabank.pl/konto-oszczednosciowe"},
        {"bank": "UniCredit", "name": "Konto Oszczędnościowe",
         "rateStandard": 4.5, "ratePromo": None, "promoLimit": None, "promoDays": None,
         "promoEndDate": None,
         "promoConditions": None,
         "promoConditionsList": ["Stała stawka 4,5% bez okresu promocyjnego", "Brak wymogu konta osobistego"],
         "requiresROR": False, "url": "https://www.unicredit.pl/pl/klienci-indywidualni/oszczednosci/konto-oszczednosciowe.html"},
        {"bank": "ING Bank Śląski", "name": "Smart Saver",
         "rateStandard": 4.3, "ratePromo": None, "promoLimit": None, "promoDays": None,
         "promoEndDate": None,
         "promoConditions": "Bez warunków",
         "promoConditionsList": ["Stała stawka 4,3% bez dodatkowych warunków", "Brak wymogu konta osobistego"],
         "requiresROR": False, "url": "https://www.ing.pl/indywidualni/oszczedzanie/smart-saver"},
        {"bank": "Citi Handlowy", "name": "Konto Oszczędnościowe",
         "rateStandard": 0.8, "ratePromo": 4.8, "promoLimit": None, "promoDays": 180,
         "promoEndDate": None,
         "promoConditions": "Citigold, min. 400 tys. zł, 3 transakcje 500 zł/mies.",
         "promoConditionsList": ["Wymaga statusu Citigold (aktywa min. 400 000 zł)", "Min. 3 transakcje po min. 500 zł/mies.", "Okres promocji: 180 dni"],
         "requiresROR": True, "url": "https://www.citibank.pl/pl/konto-oszczednosciowe.html"},
        {"bank": "Alior Bank", "name": "Konto Mega Oszczędnościowe",
         "rateStandard": 1.0, "ratePromo": 4.8, "promoLimit": 200000, "promoDays": 90,
         "promoEndDate": None,
         "promoConditions": "Nowe środki, transakcje 500 zł/mies.",
         "promoConditionsList": ["Dotyczy nowych środków", "Transakcje kartą na min. 500 zł/mies.", "Okres promocji: 90 dni", "Limit: 200 000 zł"],
         "requiresROR": True, "url": "https://www.aliorbank.pl/indywidualni/oszczednosci/konto-mega-oszczednosciowe.html"},
        {"bank": "Santander Bank Polska", "name": "Konto Select Oszczędnościowe",
         "rateStandard": 1.0, "ratePromo": 4.0, "promoLimit": None, "promoDays": None,
         "promoEndDate": None,
         "promoConditions": "Nowe środki",
         "promoConditionsList": ["Dotyczy nowych środków", "Wymagane konto osobiste Santander Select"],
         "requiresROR": True, "url": "https://www.santander.pl/klient-indywidualny/konta/konto-oszczednosciowe"},
        {"bank": "Renault Bank", "name": "Konto Oszczędnościowe",
         "rateStandard": 4.0, "ratePromo": None, "promoLimit": None, "promoDays": None,
         "promoEndDate": None,
         "promoConditions": None,
         "promoConditionsList": ["Stała stawka 4% bez okresu promocyjnego", "Brak wymogu konta osobistego"],
         "requiresROR": False, "url": "https://www.renaultbank.pl/oszczednosci/konto-oszczednosciowe"},
        {"bank": "Credit Agricole", "name": "Konto Oszczędnościowe",
         "rateStandard": 0.5, "ratePromo": 3.5, "promoLimit": 100000, "promoDays": 90,
         "promoEndDate": None,
         "promoConditions": "Nowi klienci",
         "promoConditionsList": ["Tylko dla nowych klientów Credit Agricole", "Wymagane konto osobiste CA", "Okres promocji: 90 dni", "Limit: 100 000 zł"],
         "requiresROR": True, "url": "https://www.credit-agricole.pl/klienci-indywidualni/konta/konto-oszczednosciowe"},
        {"bank": "PKO BP", "name": "Konto Oszczędnościowe",
         "rateStandard": 0.5, "ratePromo": None, "promoLimit": None, "promoDays": None,
         "promoEndDate": None, "promoConditions": None,
         "promoConditionsList": ["Wymagane konto osobiste PKO BP", "Stawka standardowa 0,5%"],
         "requiresROR": True, "url": "https://www.pkobp.pl/klienci-indywidualni/konta/konto-oszczednosciowe/"},
        {"bank": "mBank", "name": "eKonto Oszczędnościowe",
         "rateStandard": 0.5, "ratePromo": None, "promoLimit": None, "promoDays": None,
         "promoEndDate": None, "promoConditions": None,
         "promoConditionsList": ["Wymagane konto osobiste mKonto", "Stawka standardowa 0,5%"],
         "requiresROR": True, "url": "https://www.mbank.pl/indywidualny/oszczednosci/ekonto-oszczednosciowe/"},
    ]


# ─── Merge & generate ────────────────────────────────────────────────────────

def merge_accounts(all_accounts):
    merged = {}
    for acc in all_accounts:
        key = f"{acc['bank'].lower()}|{acc.get('name', '')[:25].lower()}"
        if key not in merged:
            merged[key] = dict(acc)
        else:
            ex = merged[key]
            for rate_field in ['ratePromo', 'rateStandard']:
                if acc.get(rate_field) and (not ex.get(rate_field) or acc[rate_field] > ex[rate_field]):
                    ex[rate_field] = acc[rate_field]
            for field in ['promoDays', 'promoLimit', 'promoEndDate', 'promoConditions',
                          'promoConditionsList', 'url']:
                if acc.get(field) and not ex.get(field):
                    ex[field] = acc[field]
    return list(merged.values())


def load_existing_keys(output_path):
    """Zwraca zbiór kluczy (bank|name) z aktualnego pliku JS — do wykrywania nowych ofert."""
    existing = set()
    if not output_path.exists():
        return existing
    text = output_path.read_text(encoding='utf-8')
    banks = re.findall(r'bank:\s*"([^"]+)"', text)
    names = re.findall(r'name:\s*"([^"]+)"', text)
    for b, n in zip(banks, names):
        existing.add(f"{b.lower()}|{n[:25].lower()}")
    return existing


def generate_js_file(accounts, output_path):
    today = datetime.now().strftime("%Y-%m")
    updated_at = datetime.now().strftime("%Y-%m-%d %H:%M")

    # Wykryj które oferty są nowe (nie było ich w poprzednim pliku)
    existing_keys = load_existing_keys(output_path)

    accounts_sorted = sorted(
        accounts,
        key=lambda x: (x.get('ratePromo') or x.get('rateStandard') or 0),
        reverse=True
    )

    for acc in accounts_sorted:
        key = f"{acc.get('bank','').lower()}|{acc.get('name','')[:25].lower()}"
        if key not in existing_keys:
            acc['isNew'] = True
        elif not acc.get('isNew'):
            acc['isNew'] = False

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
        '// Automatycznie generowane przez fetch_savings_rates.py',
        f'// Ostatnia aktualizacja: {updated_at}',
        '// Źródła: Moneteo.com, Bankier.pl, Comperia.pl, oficjalne strony banków',
        '',
        'export const SAVINGS_RATES_DB = {',
        f'  lastUpdated: "{today}",',
        '  accounts: [',
    ]

    for acc in accounts_sorted:
        lines.append('    {')
        for field in ['bank', 'name', 'rateStandard', 'ratePromo', 'promoLimit',
                      'promoDays', 'promoEndDate', 'promoConditions', 'promoConditionsList',
                      'requiresROR', 'isNew', 'url']:
            lines.append(f'      {field}: {js_val(acc.get(field))},')
        lines.append('    },')

    lines += ['  ],', '};', '']
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text('\n'.join(lines), encoding='utf-8')
    print(f"✅ Zapisano {len(accounts_sorted)} kont → {output_path}")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("🏦 Aktualizacja stawek kont oszczędnościowych")
    print(f"   {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print("=" * 60)
    print()

    scraped = []

    # Zbieraj ze wszystkich źródeł
    for fetch_fn in [fetch_moneteo, fetch_bankier, fetch_comperia]:
        try:
            results = fetch_fn()
            print(f"   → {len(results)} ofert")
            scraped.extend(results)
        except Exception as e:
            print(f"   ❌ {e}")

    total_scraped = len(set(a['bank'] for a in scraped))
    print(f"\n📊 Scraped łącznie: {len(scraped)} ofert ({total_scraped} banków)")

    # Claude fallback gdy scraping za słaby
    if total_scraped < 5:
        anthropic_key = os.environ.get('ANTHROPIC_API_KEY')
        if anthropic_key:
            claude_results = fetch_with_claude(anthropic_key)
            scraped.extend(claude_results)
        else:
            print("⚠️  ANTHROPIC_API_KEY nie ustawiony — pomijam Claude fallback")

    # Zawsze scal z hardcoded (zachowuje promoConditionsList, url, promoEndDate)
    hardcoded = get_hardcoded_rates()
    merged = merge_accounts(scraped + hardcoded)

    print(f"\n📊 Po scaleniu: {len(merged)} unikalnych ofert")
    print()

    generate_js_file(merged, OUTPUT_FILE)
    print("\n🎉 Gotowe!")


if __name__ == "__main__":
    main()
