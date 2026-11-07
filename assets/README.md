# Ilustracje zwierząt — 2.2.0

`animals.webp` to gotowy przezroczysty arkusz 1536 × 1536 px. Każde pole ma 512 × 512 px, a sylwetka mieści się w obszarze 456 × 456 px. Zachowano kolory i półprzezroczyste krawędzie źródłowych ilustracji; normalizacja obejmuje wyodrębnienie zwierząt, skalę i rozmieszczenie w atlasie.

| Wiersz | Pole 1 | Pole 2 | Pole 3 |
| --- | --- | --- | --- |
| 1 | rabbit | sheep | pig |
| 2 | cow | horse | smallDog |
| 3 | bigDog | wolf | fox |

`SYMBOLS.load(done, onError)` dekoduje arkusz przed pierwszym użyciem. `drawAnimal`, `sprite` i `buildAtlas` pozostają synchroniczne po zakończeniu wczytywania. Atlas kostek nadal ma siatkę 4 × 2 i kolejność rabbit, sheep, pig, cow, horse, wolf, fox; ósme pole jest puste. Psy występują w interfejsie.

`node build.mjs` osadza WebP w obu wynikowych plikach HTML. Gotowa gra nie pobiera grafiki z sieci. Surowe strony w `dev/` wczytują lokalny plik z `assets/`.

## Przygotowanie

Ilustracje wygenerowano za pomocą wbudowanego narzędzia OpenAI imagegen, z przezroczystym tłem. Nie używano trybu CLI ani osobnego klucza API. Każde zwierzę sprawdzono osobno oraz po złożeniu w atlas i pomniejszeniu do rozmiarów HUD-u. Widok sceny i fizyka pozostają wspólne dla wcześniejszych oraz nowych nadruków.

## Prompt źródłowy

```text
Use case: stylized-concept.
Asset type: one production animal illustration sprite atlas for the realistic Superfarmer board game, transparent PNG, square 3 by 3 layout, ideally 2048 by 2048 pixels.
Primary request: nine exceptionally well drawn, anatomically convincing farm and woodland animals in one cohesive naturalistic hand-painted illustration style. These are printed illustrations for ivory dice and small HUD icons, with appealing character and professional book-illustration craft. Refined gouache and fine colored-pencil detailing, gentle volumetric shading inside each animal, carefully observed anatomy, graceful curved contours and selective crisp edges. Clear compact silhouettes with strong enough dark edge contrast to remain legible small. Fine fur/featherlike brush details where useful, no uniform cartoon outlines.
Layout is strictly a 3x3 sprite sheet of nine equal square cells, one completely isolated full animal centered in each. No grid lines. Generous transparent gutters and at least 12 percent safety padding inside each cell; every ear, hoof, paw and tail is visible and contained. Each animal should occupy a similar optical size, near 78 percent of its cell's longest dimension. All in calm natural three-quarter side profiles facing right, rendered at consistent eye level with the same soft upper-left light.
Exact order, left to right:
TOP ROW: (1) a compact warm grey-brown domestic rabbit sitting low with a large rounded haunch, a very short neck, a soft broad rabbit muzzle, small short forepaws beneath the chest, two proportionate softly curved upright ears, creamy belly and tiny white round tail; it must look like a real rabbit, never a kangaroo. (2) a sturdy cream-wool sheep with soft sculpted fleece, a warm dark grey face and four believable legs. (3) a pale rosy domestic pig with a round heavy body, convincing short cloven-hoof legs, soft floppy ears, correct broad snout and tiny curled tail.
MIDDLE ROW: (4) a black-and-ivory dairy cow, sturdy correct bovine anatomy, gentle head and warm pink muzzle, four legs and small udder, restrained horn tips. (5) an elegant chestnut horse with a dark mane and tail, anatomically correct neck, hocks and hooves, a small white facial blaze. (6) a friendly small tricolor beagle standing naturally, floppy ears, rounded paws, white chest and tail tip, understated green collar.
BOTTOM ROW: (7) a handsome seated German shepherd guardian dog with proportional head and ears, substantial chest, two separate naturally placed front paws, a convincingly bent rear leg, fur-softened edges, a relaxed curved tail, tan coat and dark saddle, understated dark green collar. (8) a lean grey wolf standing, correct canine anatomy, thick grey coat and ruff, lowered bushy tail, distinctly wild and different from both dogs. (9) a russet red fox standing with graceful slender legs, pointed soft muzzle, black stockings, creamy chest and a large sweeping bushy tail with a white tip.
Palette: natural warm umber, chestnut, ochre, soft ivory, dusty pink and cool grey, rich but restrained, never muddy. The light areas must still have subtle defined edges on an ivory background.
Background: actual alpha transparency everywhere outside the animals, including spaces between legs and ears. No backdrop, ground, floor, grass, oval shadow, labels, letters, numbers, decorations, frames or watermarks.
Avoid: angular vector cutouts, diagrammatic polygons, children's clipart, emoji, chibi, Disney style, enormous eyes, smiling human mouths, uniform thick black outline, sticker border, halo, photorealistic collage, glossy 3D toy rendering, extra or merged limbs, cropped extremities. This must be a cohesive premium illustrated animal atlas with a substantial visible craft improvement over simple canvas icons.
```

