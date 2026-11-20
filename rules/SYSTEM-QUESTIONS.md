# Design system interview

Two rounds, each one message with bold recommended defaults. Round one comes before you read the code; round two comes after. Each round ships as the SystemAsk block where the chat can show it; a typed reply always works.

Name: derived from the project, stated as an assumption. The user renames it in Design Chamber, so never ask for the name.

## Round one: before you read the code

Ask these four in one message, before you read the code in depth. Nothing is written until the user answers. "go", the user's own words of acceptance, or the block's Go with these accepts the defaults; apply any changes to the answers and do not ask the round again.

Never ask what the files already answer. No project repo in the chat: don't ask the home or the mode; say the system lives in Design Chamber and the repo stays untouched. A project that is the Designs folder: the same, plus "Pick your app's folder, not the Designs folder."

### Where should the design system live? {#home}
- **Repo + living page** {#repo}: The system and its living page ship with your repo, next to the code.
- In Design Chamber {#internal}: Stays in the Designs folder. No page in the repo.

### Should building it also fix the code, or only describe what should be? {#mode}
- **Fix tokens, then document** {#fix}: I change the token definitions in your code after you approve a diff.
- Describe only, never change the app's code {#describe}: The system documents the target and your code keeps its values. New system files are still created after you approve a diff.

### Which parts should it cover? {#coverage}
Pick any.
- **Foundations** {#foundations}: Colour, type, space, radius, shadows, layers and sizes.
- **Components** {#components}: The components the code has, with when to use them.
- **Patterns & voice** {#patterns}: Layout patterns and how the product speaks.
- **Brand & marketing** {#brand}: Logos, brand guidance and marketing surfaces.

### Dark mode as part of this? {#dark}
- **Not now** {#not-now}: Light values only. Dark can be added later.
- Include dark values {#include}: I derive a dark value for every colour, and round two asks how.

Reply with changes, or say go to accept the defaults.

## Round two: after you read the code

Read the code first, read-only. Then ask only the calls the findings raise, in one message. Each call cites concrete counts and files ("about 700 uses across 40 files; amber in 12, orange in 8"), never file contents beyond the short values the call needs. A call the code does not raise is not asked. Ask "Who can open the living page" only for a repo home, and "Dark values" only when round one included dark mode.

### Status colours {#status-colours}
- **Brand-tuned set** {#brand-tuned}: One warning, one danger, one success, tuned to your brand. The proposed values are shown with this call.
- Keep the stock set {#stock}: The code keeps its current status colours. The system records them as they are.
- Custom {#custom}: Say what you want in the note.

### Greys {#greys}
- **Brand-tinted greys** {#brand-tinted}: The neutral ramp leans a few degrees toward the brand hue.
- Keep neutral grey {#neutral}: The current greys stay; only the colours change.

### Who can open the living page {#access}
- **Dev builds only** {#dev}: The page ships in the repo and is not published.
- Public {#public}: GitHub Pages or a similar host. Fonts fall back unless you turn on Embed fonts.

### Typography {#typography}
- **One font only** {#one-font}: The same font everywhere, including marketing headings.
- Add a display font {#display}: A second face for marketing headings. Specimens fall back where the face is missing.

### Dark values {#dark-values}
- **Derive dark values from the light ones** {#derive}: A dark value for every colour, computed from the light set. Consistent, and quick to review.
- Hand-tune them with me {#hand-tune}: We go through the dark values together, one group at a time.

Reply with changes, or say go to accept the defaults.

## After two rounds

Never ask a third round. Anything still uncertain becomes an assumption stated in the overview, or one open question at the end of the build reply. Write down what was agreed: the answers are the system's record, and the agreed token calls are the system's values.
