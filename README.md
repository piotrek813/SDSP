<h1>
  <img
    src="./favicon.svg"
    alt="Cadence logo"
    width="40"
    style="vertical-align: middle;"
  />
  <span style="vertical-align: middle;">Cadence — Man plans, God laughs</span>
</h1>

Always behind a schedule? That's life as Frank Sintara would put it.
So don't worry we're here to save the day, now you'll always be behind an **optimized schedule** ✨.
Sounds better? Alrighty, then let's get started!



## Uruchomienie

**Windows (użytkownicy nietechniczni):** kliknij dwukrotnie **`start.bat`**. Uruchamia
`server/sdsp.exe`, który żyje w **zasobniku systemowym** (czerwona ikona), otwiera
przeglądarkę na `http://127.0.0.1:3000` automatycznie i serwuje aplikację.
Zamknij planistę z ikony zasobnika (prawy przycisk → *Zakończ*).

- Przebuduj exe po zmianach: uruchom **`server/build.bat`** (wymaga
  [Go](https://go.dev/dl)). Osadza ikonę (`server/assets/icon.ico`) i info o wersji.
- Wiersz poleceń: `server/sdsp.exe --port 3000 --no-open --no-tray`.

Podczas rozwoju:
```bash
pnpm install
pnpm run serve          # http://localhost:5173
pnpm test               # 39 testów (solver + excel + heldkarp)
pnpm run benchmark      # benchmark solverów
```

## Format skoroszytu

Pięć arkuszy (nazwy dopasowywane luźno): **Setup Matrix** (macierz przezbrojeń),
**Codes** (kody), **Shifts** (zmiany), **Breaks** (przerwy), **Settings** (ustawienia).

- Setup Matrix: rodziny w nagłówku i pierwszej kolumnie, minuty w komórkach
- Codes: `Code`, `Family`, `Unit time (s)`, opcjonalnie `Description`, `Qty`
- Shifts: `Start`, `End` (mogą przechodzić przez północ)
- Breaks: `Start`, `End` — odejmowane od zmian
- Failures: `Date`, `Start`, `End`, `Comment` — jednorazowe awarie
- Order: `Code`, `Qty`, `Produced` — przywraca zapisaną kolejkę
- Settings: `OEE`, `Start date`, `Planning direction`, `Crew size`, `Crew factor f(x)`, `Initial family`

## Funkcje

- **Optymalizacja Held–Karpa** — dokładna, do 18 rodzin w czasie interaktywnym
- **Kierunek planowania** — w przód lub w tył (od daty terminu)
- **Kolejka ręczna** — edytuj kolejność, mieszaj rodziny, stan portfela pokazuje koszt
- **OEE** — suwak rozcieńcza czas produkcji; czerwona karta pokazuje straty
- **Awaria** — jednorazowe okno przestoju z komentarzem
- **Święta** — pełne dni niepracujące z pliku
- **Obsada** — liczba pracowników z współczynnikiem f(obsada)
- **Eksport** — skoroszyt, SVG, PNG

## Znane ograniczenia

- Held–Karp obsługuje do 18 rodzin; powyżej kolejka działa bez optymalizacji
- Przezbrojenia nie są przerywane w połowie
- Kalendarz modeluje pojedynczy powtarzalny wzór dnia
