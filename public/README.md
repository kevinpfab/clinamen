# public/

Vite serves everything here at the site root, verbatim. `index.html` references
these marks, produced by the asset generator:

    bun run gen:assets

Then drop the downloads into this folder:

| File                   | From the generator's… | Used by                          |
| ---------------------- | --------------------- | -------------------------------- |
| `favicon-32.png`       | Favicon · 32          | browser tab (standard)           |
| `favicon-16.png`       | Favicon · 16          | browser tab (small)              |
| `apple-touch-icon.png` | Favicon · 180         | iOS home-screen icon             |
| `og-image.png`         | OG / social · 1200×630 | link previews (og:image, twitter) |

The `favicon-512.png` export is optional — add it plus a web app manifest only
if this ever ships as an installable PWA.
