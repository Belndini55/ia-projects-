# Makro Studio

Graficzny edytor makr klawiatury i myszy napisany w Pythonie. Aplikacja działa lokalnie w przeglądarce, bez konta, bez zewnętrznych usług i bez obowiązkowych bibliotek — makra są zapisywane w pliku JSON na Twoim komputerze.

## Uruchomienie

Wymagany jest Python 3.10 lub nowszy.

```bash
python app.py
```

Otwórz adres **http://127.0.0.1:8000**. Serwer domyślnie nasłuchuje tylko na lokalnym komputerze. Port można zmienić, np. `python app.py --port 8080`. Zatrzymaj aplikację przez `Ctrl+C` w terminalu.

## Co potrafi edytor

- Graficzne układanie akcji: skróty klawiszowe, pojedyncze klawisze, tekst, kliknięcia, ruch kursora, przewijanie i opóźnienia.
- Zagnieżdżone pętle do 8 poziomów, własne etykiety kroków, zmiana kolejności przez przeciąganie albo strzałki.
- Bezpieczny podgląd sekwencji bez wysyłania wejścia do innych aplikacji.
- Opcjonalne wykonanie makra na komputerze (mysz i klawiatura), zatrzymywanie działania i dziennik kroków.
- Automatyczny zapis, biblioteka makr, duplikowanie oraz import i eksport JSON.
- Opcjonalna rejestracja globalnych skrótów systemowych (wymaga `pynput` i uprawnień dostępnościowych w niektórych systemach).

## Tryb rzeczywisty (opcjonalnie)

Domyślnie przycisk **Testuj** uruchamia wyłącznie podgląd. Przycisk **Uruchom** prosi o potwierdzenie, odlicza 3 sekundy (przełącz się wtedy do okna docelowego), a następnie steruje pulpitem. Przed uruchomieniem zapisz pracę i sprawdź sekwencję. Awaryjne przesunięcie kursora do lewego górnego rogu ekranu uruchamia zabezpieczenie PyAutoGUI. Globalne skróty makr działają po instalacji `pynput`; niektóre systemy mogą wymagać dodatkowych uprawnień dostępnościowych.

Aby włączyć prawdziwe sterowanie oraz globalne skróty systemowe, zainstaluj opcjonalne pakiety:

```bash
python -m pip install -r requirements-live.txt
```

Do wstawiania polskich znaków wymagany jest również działający schowek systemowy. Aplikacja nie wykonuje poleceń powłoki i nie uruchamia makr automatycznie przy starcie.

## Dane i pliki

- Biblioteka makr: `user_data/macros.json` (tworzy się automatycznie przy pierwszym uruchomieniu).
- Eksportowane pliki JSON można przenosić lub wersjonować niezależnie od aplikacji.
- Ścieżkę biblioteki można nadpisać zmienną `MAKRO_STUDIO_DATA`.

## Testy

```bash
python -m unittest discover -s tests -v
```

## Ograniczenia bezpieczeństwa

Makra mogą wysyłać tekst i naciskać klawisze do aktualnie aktywnej aplikacji; przed trybem rzeczywistym zawsze sprawdź sekwencję w podglądzie. Serwer nie ma uwierzytelniania i jest przeznaczony do pracy lokalnej — nie wystawiaj go bezpośrednio do publicznej sieci.
