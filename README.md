# Superfarmer — przy jednym stole

Nowa odsłona przeglądarkowego Superfarmera: jasny interfejs w kolorach pergaminu, leśnej zieleni i bursztynu, fizyczne kostki, trzy tryby gry oraz działanie offline.

Gra opiera się na Superfarmerze Karola Borsuka („Hodowla zwierzątek”, 1943). Zachowuje założenia zasad klasycznego wydania opisane w pierwotnym projekcie.

## Szybki start

1. Sklonuj [repozytorium](https://github.com/guziczak/superfarmer) lub pobierz je przez **Code → Download ZIP** i rozpakuj. Jeśli masz gotową paczkę ZIP z grą, rozpakuj cały jej folder.
2. Otwórz **`index.html`** w aktualnej przeglądarce.
3. Wybierz grę z Zenkiem albo dwie osoby przy jednym telefonie.

Nie trzeba instalować pakietów ani budować projektu, aby zagrać. Cała logika, biblioteki, style i grafika gry są w gotowym HTML. Zewnętrzne pliki służą instalacji aplikacji i pamięci offline.

Na telefonie wygodniej otworzyć grę przez serwer lub hosting. Gra na dwóch urządzeniach wymaga wspólnej sieci Wi-Fi/hotspotu; skaner kamery wymaga HTTPS lub localhost. Sam plik `file://` nie zapewnia dostępu do wszystkich funkcji przeglądarki.

## Co jest w tej wersji

- Nowy ekran startowy, własna ilustracja SVG i trzy czytelne karty trybów.
- Przebudowana scena: jasny matowy blat, niska zaokrąglona taca, filc z przeszyciem i znakiem gospodarstwa oraz delikatniejsze światło.
- Dwie rozróżnialne kostki — porcelanowa i bursztynowa — z płaskimi pięciokątnymi ściankami, wąską zaokrągloną fazą i medalionami.
- Nowy wspólny zestaw dziewięciu portretów zwierząt na kostkach i w interfejsie.
- Karty stad z licznikiem zebranych gatunków, paskiem postępu i numerem rundy.
- Niższe karty graczy oraz kompaktowy panel statusu podczas rzutu, z zachowaniem wygodnych przycisków dotykowych. Zmiana panelu nie przesuwa kostek w locie ani po zatwierdzeniu wyniku.
- Odświeżone wymiany, zasady, historia, formularze parowania oraz ekran zwycięstwa.
- Czytelne oznaczenie aktywnego gracza, opisowe etykiety, obsługa klawiatury, zamykanie dialogów przez Escape i przywracanie fokusu.
- Układ reagujący na szerokość ekranu, obszary bezpieczne telefonu i preferencję ograniczenia animacji.
- Brak zewnętrznych fontów i plików graficznych wymaganych do rozgrywki.
- Działająca gra także bez WebGL: widok zgodności Canvas 2D rysuje widoczne pięciokątne ścianki i wykorzystuje **ten sam silnik fizyczny, stany kostek i wynik rzutu**.
- Renderowanie wstrzymywane w bezruchu; animacje, resize i klatki sieciowe odświeżają scenę na żądanie.
- Poprawione wznowienie partii, atomowe zapisanie wyniku przed animacją i mocniejszy Zenek.
- Walidacja danych drugiego telefonu, numerów tur, kursów wymian i stanu zapasów.
- Pamięć offline ograniczona do plików tej gry i jej ścieżki; manifest oraz ikony aplikacji na urządzenia mobilne.

## Sterowanie

- **Przeciągnij po stole i puść** — rzut z prędkością gestu.
- **Dwa palce** — możliwość trzymania i rzucania kostkami osobno.
- **Rzuć** — automatyczny rzut; przyciski obsługują standardowo Tab, Enter i Spację.
- **Wymiana** — jedna wymiana przed rzutem, w dowolnym kierunku i dostępnej liczbie sztuk.
- **Menu → Zapisz i wróć do menu** — zachowuje bieżącą turę. „Wznów grę” nie przyznaje kolejnej wymiany.
- **Escape** — zamyka otwarty panel.
- **Zaawansowane** — ciężarek lub zmiana kształtu kostek. Wyświetlane częstości są orientacyjnymi wartościami wcześniejszej kalibracji; nie są gwarancją dla dowolnego sposobu rzucania.

Gdy żadna z ograniczonej liczby fizycznych prób ratunkowych nie ustabilizuje kostki, gra prosi o ponowny rzut bez zmiany stada, statystyk ani prawa do wymiany. Wynik nie jest zatwierdzany wyłącznie z powodu upływu czasu.

## Zapis i zgodność wersji

Stan jest przechowywany lokalnie w przeglądarce, jeśli zezwala ona na localStorage. Oba urządzenia w grze sieciowej przechowują zapis swojej partii; po rozłączeniu można ponownie się sparować.

Protokół sieciowy tej wersji ma numer **2**. Oba telefony muszą korzystać z tej samej nowej wersji. Stary klient otrzyma prośbę o odświeżenie obu urządzeń. Poprawne wcześniejsze lokalne zapisy są odczytywane z zachowaniem ograniczeń walidacji; stan przyjęty z sieci musi zachowywać całkowitą liczbę zwierząt.

Po pierwszym poprawnym załadowaniu przez HTTPS/localhost i zainstalowaniu service workera zasoby gry są dostępne offline. Dodanie do urządzenia jest oferowane w menu, gdy przeglądarka udostępnia instalację. Do P2P nadal potrzebna jest wspólna sieć lokalna; dostęp do Internetu nie jest warunkiem lokalnego połączenia, jeśli przeglądarki i sieć pozwalają na jego zestawienie. Nie ma serwera gry ani serwera przekazującego ruch TURN. Konfiguracja WebRTC zawiera publiczne serwery STUN.

## Development

Wymagany **Node.js 22 lub nowszy**. Projekt nie wymaga instalowania zależności npm; używane biblioteki są już w `vendor/`.

```sh
npm run dev       # serwer na http://localhost:8123
npm run build     # odświeżenie plików wynikowych
npm test          # wszystkie testy
npm run check     # testy i budowanie
```

Można również wywoływać bezpośrednio `node build.mjs` oraz skrypty w `dev/`. Parametr `?debug=1` włącza diagnostykę przepływu tur.

### Układ projektu

| Ścieżka | Zawartość |
| --- | --- |
| `index.html` | Gotowa, samodzielna gra |
| `dist/superfarmer.artifact.html` | Wariant do osadzenia w środowisku artefaktów |
| `src/markup.html`, `src/style.css` | Interfejs i oprawa |
| `src/rules.js`, `src/ai.js` | Reguły i decyzje Zenka |
| `src/main.js` | Tury, zapis, wznowienie i protokół rozgrywki |
| `src/dice3d.js` | Wspólna fizyka, renderer WebGL i renderer Canvas 2D |
| `src/net.js` | Parowanie QR, WebRTC i cykl życia połączenia |
| `src/hud.js`, `src/symbols.js`, `src/audio.js` | Prezentacja, proceduralne zwierzęta i dźwięk |
| `src/sw.js`, `src/icon.svg` | Źródła service workera i ikony |
| `icons/` | Gotowe ikony PNG 192, 512 i Apple Touch |
| `vendor/` | Biblioteki dołączane do HTML |
| `dev/` | Serwer i testy |

Edytuj pliki w `src/`, a potem uruchom build. Pliki wynikowe w katalogu głównym i wariant artefaktowy są generowane automatycznie. Ikony PNG są przygotowanymi rastrami `src/icon.svg`; przy zmianie projektu ikony należy zaktualizować je razem.

## Weryfikacja tej wersji

Uruchomione z powodzeniem:

- 31 pierwotnych asercji reguł oraz dodatkowe przypadki walidacji.
- 576 wyników rzutów sprawdzonych pod kątem zachowania liczby zwierząt i niezmieniania wejściowych obiektów.
- 6 regresji natychmiastowej wygranej Zenka i przegląd 2624 stanów, w tym 720 stanów z dostępną wygrywającą wymianą.
- 17 scenariuszy integracji stanu gry: wznowienie, animacje, wygrana, menu, wiadomości P2P i przerwany rzut.
- 151 asercji na rzeczywistym module DiceScene, w tym 30 pełnych rzutów, zamknięcie i płaskość nowej siatki, zgodność z fizycznym hullem, Canvas 2D, stabilność wyniku, odraczanie zmian HUD, resize i odświeżanie w tle/bezruchu.
- 10 kontroli pamięci offline, 7 kontroli wejścia sieciowego i bufora transmisji, 15 scenariuszy cyklu życia połączenia oraz 11 asercji kodowania i odczytu QR.
- Dotychczasowe testy geometrii, osiadania i blokowania kostek.

Testy fizyki i stanu uruchamiają rzeczywiste moduły gry; platforma przeglądarki, Canvas/DOM i transport są zastępowane w testach. Nowe symbole i projekcję kostek dodatkowo wyrenderowano rzeczywistym Canvas 2D. Wstawki vertex/fragment shaderów obu materiałów skompilowano i zlinkowano przez OpenGL ES w EGL/Mesa; sprawdza to składnię i zgodność interfejsów, ale nie zastępuje oględzin pełnego renderera WebGL. Przeglądarka kontrolna korzysta z widoku 2D. Bezpośrednia kontrola nowej sceny WebGL na telefonie i rzeczywiste parowanie dwóch urządzeń pozostają do sprawdzenia. Testy nie są dowodem statystycznej uczciwości kostek.

## Repozytorium i hosting

Ta wersja powstała na bazie commitu `056c1c7d5dc687fa0741dcea9d49be9fa7278c06` repozytorium `guziczak/superfarmer`. Repozytorium zawiera źródła, gotowy HTML i zasoby PWA.

Publikację gry na hostingu konfiguruje się osobno. Na hosting statyczny prześlij `index.html`, `sw.js`, `manifest.webmanifest`, `icon.svg` oraz cały katalog `icons/`, zachowując ich układ.
