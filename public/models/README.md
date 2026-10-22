# Product photography

Files here are served directly. Naming drives resolution — no code change
needed when you add one:

```
<model-code>-<colour-code>.webp    per colour, preferred
<model-code>.webp                  one image for the whole model
```

`ProductImage` tries the colour file, falls back to the model file, then draws
a placeholder silhouette. A partial set is fine.

**Model codes** and **colour codes** come from `src/lib/catalog/catalog.ts`.

**Format:** WebP with a transparent background. The panel behind is near-black
(`--color-ampere-ink`), so an opaque background shows as a box.

**Size:** keep each under ~100KB. This is a mobile paid-traffic page with a
180KB first-load budget. The originals Ampere supplied were 9504x6336 and
~1.5MB each; they are resized to 1100px wide here, which is ample for a panel
that renders at ~420px even on a 2x display.

Unoptimised originals are kept outside the build at `assets/models-source/`.

## Currently missing

Nothing — every model and colour in the catalog has a photograph.
