# Product photography

One folder per scooter, one file per colour per angle, in the order the
scooter's page on ampere-electric.com shows them:

```
public/models/<image>/<colour-code>-<n>.webp      n = 1, 2, 3 …
```

`<image>` and the number of angles per colour are set on each model in
`src/lib/catalog/catalog.ts` (`image`, `angles`). Two models may share a
folder: the Nexus EX+ Intellipack uses `nexus-ex-plus/`, as the main site does.
`src/lib/catalog/catalog.test.ts` fails if a colour or angle in the catalog has
no file here.

The arrows on the product panel step through the angles; the colour swatches
change the colour.

**Format:** WebP with a transparent background, resized to 1100px wide
(~50–100KB each). The originals — the main site's own files, up to 5000px and
1MB+ — are kept outside the build at `assets/models-source/site-angles/`.
