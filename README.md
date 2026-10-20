# Vellum (web)

A small internet window in the Vellum style: time and world clocks, weather, markets, headlines, Hacker News, On This Day, and photos.
It's a static web app: add it to the iPhone Home Screen, or run it full screen or in a window on a Mac.

- **Data:** free, keyless public APIs, fetched straight from the browser: Open-Meteo, CoinGecko, CNBC quotes, Wikipedia (In the news, Most read, On this day), Hacker News (Algolia).
- **Settings:** stored in this browser's localStorage. You can optionally paste a link to a Vellum config JSON in Settings. Nothing is bundled.
- **Keys:** N/Space next, P previous, 1–9 jump, R refresh, A hold, T theme, F full screen, S settings. Swipe or tap the sides to flip pages, and tap the header for settings.
- **Fonts:** IBM Plex, SIL Open Font License (fonts/OFL-IBM-Plex.txt).


Web 1.2 adds photos with captions and mandatory source/license credits. The photos block merges per field over defaults: sources, rotate_seconds (5–3600, default 20), captions (default true). Feed failures keep the last good list; an empty cache shows “No photos yet — waiting for Wi-Fi”.
Photos is the final default page (`#face=7` or `#face=photos`). Only Wikimedia POTD and Wikipedia news/event pictures are used. Configure new face lists with faces2; never put photos in faces, which older clients reject. Unknown face names are skipped. Images use contain fitting and a bounded twelve-image browser cache.
