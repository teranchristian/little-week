# Our Week

A picture based weekly planner for young children, built with React, TypeScript, Vite and Tailwind CSS. The layout and print styles come from [`reference/template.html`](reference/template.html).

## Run

```sh
npm install
npm run dev
```

`npm run build` checks TypeScript and produces the static site in `dist/`.

Activities can be added, edited, deleted and dragged within or between days and parts of the day. On touch screens, hold an activity briefly before dragging it; tapping still opens the editor. A move shows a brief Undo message. Edit family changes the planner name, member names and emojis, and adds or removes members. Choosing a member emoji already used by an activity shows a warning. The week, family and hide words setting are saved in this browser's localStorage. The print button uses the template's A4 landscape print layout.

The planner data is kept in `src/planner.ts` so recurring routines, one day exceptions and calendar integration can be added later. Those features are outside this MVP.

Activity icons use [OpenMoji](https://openmoji.org/) color SVGs, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The icon catalog includes OpenMoji names and multiple search tags. `npm run dev` and `npm run build` prepare the SVGs locally from the npm package; generated assets are kept out of Git. Existing calendar emoji values remain compatible.

In the activity or family member icon picker, **Add custom icon** opens a pop up for an image, name, and one search tag. Drag the image within the square crop area and use the Size slider to zoom before saving. PNG, JPG, WebP, and GIF files up to 5 MB are saved as a cropped 128 × 128 PNG; GIFs use their first frame. Custom activity icons are reusable only for activities, and custom family icons only for family members. They stay in this browser's localStorage and appear in printouts.

With words shown, activities appear as icon and name rows. **Hide words** removes activity names.
