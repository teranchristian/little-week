# Calendar layout

- On the desktop screen calendar, every activity card in a day part shares the available height above the Add button. One card fills it; two cards split it; three cards split it. The tallest day sets the row height, and cards in other days grow to match that row.
- Keep the compact card minimum height, but do not use a fixed flex size that leaves unused space in a day part. Preserve the separate phone, full screen, and print layouts.
- After changing calendar layout CSS, run `npm run test:layout` and `npm run build`. The layout check measures one, two, and three cards in Chrome.
