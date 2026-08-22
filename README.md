# Superfarmer 3D

Klasyczna gra Karola Borsuka („Hodowla zwierzątek", 1943) w przeglądarce — z prawdziwymi
kostkami 3D. Dwie dwunastościenne kostki z fizyką (three.js + cannon-es), rzucane
**przeciągnięciem palca** po ekranie; interfejs w całości po polsku.

Całość to **jeden plik `index.html`** (~1,1 MB) — działa z `file://`, z dowolnego hostingu
statycznego i na telefonie.

## Rozgrywka

- **Solo z botem Zenkiem** albo **2 graczy na jednym telefonie** (z własnymi imionami).
- Zasady klasycznego wydania (Granna): rozmnażanie parami (stado + kostki), lis kradnie
  króliki, wilk pożera wszystko oprócz koni i małego psa, psy bronią, jedna wymiana ze
  Stadem Głównym na turę (w obie strony), limity Stada Głównego.
- Wygrywa pierwszy komplet: koń, krowa, świnia, owca, królik.

## Sterowanie

- **Przeciągnij palcem po stole i puść** — rzut z prędkością gestu (tap = szybki podrzut).
- **Dwa palce** — każdy palec trzyma i rzuca osobną kostkę.
- Przycisk **„Rzuć"** robi rzut automatyczny; **„Wymiana"** otwiera kursy wymiany.
- Gra zapisuje stan po każdej turze (można wznowić po zamknięciu karty).

## Techniczne

- **Kostki**: bryła to matematycznie foremny dwunastościan (weryfikacja:
  `node dev/check-parallel.mjs` — każda para przeciwległych ścianek idealnie równoległa).
  Zaokrąglone krawędzie generowane wygładzaniem LogSumExp, symbole zwierząt malowane
  w shaderze z proceduralnego atlasu (canvas 2D, zero plików graficznych).
- **Fizyka**: cannon-es, krok 1/120 s; ścianki tacy, wykrywanie spoczynku, przerzut kostki
  opartej o przeszkodę. Po rzucie kostka **leży tak, jak upadła** — bez żadnych korekt.
- **Dźwięk**: syntezowany WebAudio (stuki zależne od siły uderzenia, fanfary, szczekanie).
- Grafika zwierząt wspólna dla kostek, HUD-u i konfetti.

## Development

```
node dev/serve.mjs          # serwer deweloperski na :8123 (także dla telefonu w tej samej sieci)
node build.mjs              # składa index.html oraz dist/superfarmer.artifact.html
node dev/test-rules.js      # testy logiki zasad (31 asercji)
node dev/physrepro.mjs full # headless test fizyki (30 rzutów)
node dev/check-parallel.mjs # dowód równoległości ścianek k12
```

Źródła w `src/` (rules, symbols, dice3d, hud, ai, audio, main + style/markup),
biblioteki w `vendor/`, strony pomocnicze w `dev/`. Adres `?debug=1` włącza logi przepływu tur.
