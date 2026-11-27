# Brand

Read this before you write `logos` or `brand` in `system.json`, when the Brand & marketing area is covered. Brand is how the company looks outside the product: the logo, the marketing palette, imagery, landing pages, social images and email. The product's own colours stay in foundations.

## Brand entries

```json
{ "id": "logo-use", "kind": "logo-use", "title": "Logo use", "note": "Clear space of one mark height. Never below 24px tall.", "example": "brand/logo-use.html", "layout": "full" }
```

- Kinds: `logo-use`, `colour`, `imagery`, `marketing`, `social`, `email`, `other`.
- Body in `brand/<id>.md`, example in exactly `brand/<id>.html`. Examples follow the component example rules in `components.md`: a fragment, tokens only, no scripts, nothing from the internet.
- Brand examples are wide. Give them `layout: "full"`.

## Logos

### Files

- Put every logo file in `assets/logos/` (svg, png, jpg or webp) and list it in `logos` with `file`, `variant` and `note`. SVG is preferred; it must hold no script, event attributes or links to other files.
- Variants, lower-case words: `primary` (the full lockup), `mark` (the symbol alone), `wordmark`, `on-dark` (the version for dark grounds), `mono` (one colour, for stamps and partner pages). Ship what the project has; ask before drawing a variant it doesn't.
- Each note says where the file is used: "App header and sign-in. Not for favicons."

### The logo-use entry

Write `brand/logo-use.md` with:

- **Clear space**: a measured unit, usually the height of the mark or of one letter, kept empty on every side.
- **Minimum size**: the smallest height in px for screen (often 24px for the lockup, 16px for the mark) and in mm for print if the brand prints.
- **Grounds**: which variant goes on light, on dark, on the brand colour and on photos. On photos, only over a calm area or a scrim.
- **Misuse**: never stretch, recolour outside the listed variants, add effects (shadows, outlines, gradients), rotate, rebuild the lockup, or place it on a busy ground.
- **Co-branding**: a divider and equal visual weight, the partner on the right.

The board draws each logo file once, on its own card. In the example, show clear space and minimum size around an inline SVG copy of the mark, and a misuse row with each wrong use labelled in words. Don't link to the logo files from the example.

## Brand colour

One entry with `kind: "colour"`, written from the interview's `brand-colour` answer:

- `split` (the default): the brand palette (`--brand-primary`, `--brand-secondary`, tints such as `--brand-primary-100`) is for marketing fills, illustrations and social images. The app uses `--accent` alone for actions, links, focus and selection. Say which tokens belong to which side.
- `one`: the brand colour is `--accent` everywhere. Say it is the same colour, and list the contrast pairs that make it work.
- Either way: where each brand colour may be used, how much of a layout it may cover (for example "brand primary up to a third of a hero"), which text colours sit on it with their ratios, and that brand colours never stand in for status colours.

The example shows the palette as large blocks with the text colours on each, labelled with token names and ratios.

## Imagery and illustration

One entry with `kind: "imagery"`:

- **Photography**: subjects (real customers, real work, the product in use), light, crop, colour treatment, and what to avoid (staged handshakes, laptops on beaches, faces cropped at the eyes).
- **Illustration**: line weight, corner style, fill colours from the brand palette, level of detail, perspective, and where illustration is used (empty states, onboarding, marketing) or never used (errors, dense tools).
- **Icons versus illustration**: icons are UI and follow the icon size tokens; illustrations are content and never sit inside controls.
- **Alt text**: say what the image shows and why it is there. Decorative images get empty alt.

Draw a few small inline SVG samples in the example to show the illustration style, and describe photography in the body. Never pull images from the internet.

## Marketing pages

One entry with `kind: "marketing"` for the landing page and its sections:

- **Hero**: a headline of up to about 10 words that says what the product does, a sub-line of one or two sentences, one primary call to action and at most one secondary, and the real product as the image. Headline in the display style (or h1 when there is one font).
- **Order of a landing page**: hero; proof (customer logos or one strong number); 3 to 5 features, each with real UI and a sentence on the outcome; a testimonial with a name and role; pricing or a plan summary; questions people ask; a closing call to action; footer.
- **Spacing**: bands of 64 to 120px apart on laptop, 48 to 64px on phone; content inside `--container-lg`; reading text inside `--measure`.
- **Avoid**: gradient blobs, three equal feature cards by default, stock icons in circles, fake dashboards, more than two typefaces, and any colour that is not in the system.
- **Phone**: the hero stacks with the image after the text, calls to action go full width, and the page never needs sideways scrolling.

The example draws a scaled-down hero and one feature band, at laptop and phone widths side by side. For the whole page, add a screen of kind `marketing`.

## Social images

One entry with `kind: "social"`. The sizes and their safe areas:

| Use | Size (px) | Keep text inside |
|---|---|---|
| Link preview (Open Graph, LinkedIn, X) | 1200 by 630 | 60px from every edge; the centre 1000 by 500 |
| Square post | 1080 by 1080 | 80px from every edge |
| Portrait post | 1080 by 1350 | 80px from every edge |
| Story, reel | 1080 by 1920 | 250px from the top, 340px from the bottom, 80px each side |

- One message per image, at most about 12 words, in the display style at 56px or more on the 1080px canvases.
- The logo in the same corner every time, at the same size.
- Backgrounds from the brand palette or a calm photo with a scrim; text passes 4.5:1.
- A template per size, with the variable parts named (headline, image, date).

Make each template a screen of kind `marketing` at its real size, listed in `screens` with its own viewport (screen rules in `patterns.md`):

```json
{ "id": "social-link", "title": "Link preview", "kind": "marketing", "viewports": [{ "id": "og", "label": "Link preview", "width": 1200, "height": 630 }] }
```

Size the page to exactly that box with no scrolling. For the card on the brand entry, draw the template scaled down: a frame with `aspect-ratio: 1200 / 630; width: 100%; container-type: inline-size; position: relative; overflow: hidden`, with type sized in `cqw` so it scales with the frame. Mark the safe area with a dashed outline in `--border` and say so in a caption.

## Email

One entry with `kind: "email"`:

- **Width**: 600px content, single column, centred. On phone it fills the screen with 16px padding.
- **Fonts**: web fonts load in only a few mail apps. Name the brand font first and fall back to a safe stack: `"Brand Sans", Arial, Helvetica, sans-serif`, or Georgia for a serif brand. The design must work in the fallback.
- **Type**: body 16px with line height 1.5, headings 24 to 28px, nothing under 14px.
- **Buttons**: at least 44px tall, built from a padded link with a solid fill, labelled with the action. One primary per email.
- **Images**: every image has alt text and a width; the email must still read with images off. Keep image text out of the critical message.
- **Dark mode**: many mail apps invert colours. Use a logo with a transparent ground and the `on-dark` variant where supported, avoid pure white blocks around images, and keep brand colours mid-tone so they survive the inversion.
- **Parts**: preheader text, header with logo, the message, one call to action, a footer with the company name, the postal address and an unsubscribe link.
- **Production note**: real emails are built with tables and inline styles. The example only shows the design; say that in the body.

Make the email template a screen of kind `marketing` with a fixed viewport, `{ "id": "email", "label": "Email", "width": 600, "height": 1200 }`. The brand entry's example shows it scaled down.

## Done for this area

Core: a logo file or a `logo-use` entry. Full: logo use, the brand colour entry, imagery, and marketing, which a `marketing`, `social` or `email` entry satisfies. Add social and email entries when the company posts or sends them.
