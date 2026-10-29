# Little Week

A picture based weekly planner for young children, built with React, TypeScript, Vite and Tailwind CSS. The layout and print styles come from [`reference/template.html`](reference/template.html).

## Run

```sh
npm install
npm run dev
```

`npm run build` checks TypeScript and produces the static site in `dist/`.

Activities can be added, edited, deleted and dragged within or between days and parts of the day. On touch screens, hold an activity briefly before dragging it; tapping still opens the editor. A move shows a brief Undo message. Edit family changes the planner name, member names and emojis, and adds or removes members. Choosing a member emoji already used by an activity shows a warning. Calendar view lets you start on Monday (default), Sunday, or Today. Today can show 1–7 days including today, and rolls forward as the date changes. Activities remain attached to their weekdays. The week, family, calendar view and custom icons are saved in this browser's localStorage. The print button uses the template's A4 landscape print layout.

`npm test` checks the calendar ordering, date rollover, day-count limits, and saved-setting validation.

The planner data is kept in `src/planner.ts` so recurring routines, one day exceptions and calendar integration can be added later. Those features are outside this MVP.

Activity icons use [OpenMoji](https://openmoji.org/) color SVGs, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The icon catalog includes OpenMoji names and multiple search tags. `npm run dev` and `npm run build` prepare the SVGs locally from the npm package; generated assets are kept out of Git. Existing calendar emoji values remain compatible.

The **Custom icons** button opens separate People and Activities lists. Add a picture icon there, or edit an existing icon's name, search tag, and optionally its image. Editing an icon updates it wherever it is used. Deleting an icon asks for confirmation; people or activities using it switch to a standard emoji. Icons can also be added from the activity and family member pickers. Drag a new image within the square crop area and use the Size slider to zoom before saving. PNG, JPG, WebP, and GIF files up to 5 MB are saved as a cropped 128 × 128 PNG; GIFs use their first frame. Custom activity icons are reusable only for activities, and custom people icons only for family members. They stay in this browser's localStorage and appear in printouts.

Activities appear as icon and name rows.
