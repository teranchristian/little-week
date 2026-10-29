# Our Week

A picture based weekly planner for young children, built with React, TypeScript, Vite and Tailwind CSS. The layout and print styles come from [`reference/template.html`](reference/template.html).

## Run

```sh
npm install
npm run dev
```

`npm run build` checks TypeScript and produces the static site in `dist/`.

Activities can be added, edited and deleted in each part of each day. The week and the hide words setting are saved in this browser's localStorage. The print button uses the template's A4 landscape print layout.

The planner data is kept in `src/planner.ts` so recurring routines, one day exceptions and calendar integration can be added later. Those features are outside this MVP.

OpenMoji asset replacement and attribution are deferred to the next icon pass. The app currently uses the template's emoji characters.
