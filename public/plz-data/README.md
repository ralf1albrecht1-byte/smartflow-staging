# PLZ / Ort data

These JSON files map postal codes to place names for CH, DE, AT, FR, IT and LI.

## Data source & licence

Data © [GeoNames](https://www.geonames.org/) — licensed under **CC BY 4.0**.

Dumps are taken from <https://download.geonames.org/export/zip/> and processed by
`scripts/build-plz-data.ts`. For Germany, "corporate" special-ZIP records
(those without a GeoNames accuracy code) are filtered out.

## Rebuild

1. Download the six country dumps (CH, DE, AT, FR, IT, LI) and place the
   extracted `.txt` files in `/tmp/geonames/`.
2. Run `yarn tsx scripts/build-plz-data.ts` from `nextjs_space/`.
