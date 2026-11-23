# deploy/data

`pincode-geo.csv`: one location per Indian pincode (18,668 rows), the
`pincode_geo` table as the dealer radius search uses it. Exported 2026-11-23
from the cleaned local database, with the hand corrections in
`src/lib/dealers/pincode-geo.ts` applied (500064 Falaknuma among them).

Load it on a new database with `--as-is`, so it is not cleaned a second time:

```bash
pnpm db:import-pincodes deploy/data/pincode-geo.csv --as-is
```

On the droplet that runs in the `tools` service, which mounts this folder
read-only. See `deploy/README.md`.

Source: India Post's All India Pincode Directory, data.gov.in, Government
Open Data Licence – India. Attribution: Department of Posts, Government of
India.
