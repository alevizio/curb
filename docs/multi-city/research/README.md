# Multi-city research output (1 Oct 2026)

The full research behind `../boston.md` and `../buenos-aires.md`: datasets, rules, gaps, asks, code
coupling and verification, with a link to every source.

- `boston/research-2026-10-01.json`
- `buenos-aires/research-2026-10-01.json`

The large source files used during the research were not kept (removed 16 Oct 2026). All are public
downloads, linked in the JSON files:

- Boston SAM street segments (`SAM/Live_SAM_Address/FeatureServer/3`, about 11 MB as GeoJSON)
- Buenos Aires curb rules layer (IDECABA `estacionamiento_normativa`, WFS, about 26 MB). Its license
  forbids commercial use, so never commit it.
- Buenos Aires street centerlines (`callejero`), the paid block sides PDF (Tramos Tarifado Feb-25) and the
  traffic code texts (Código de Tránsito y Transporte, Ley 451)

The Boston join test (sweeping schedule rows to SAM segments, 91% matched) ran in a session scratchpad and
was not kept; `../boston.md` describes the method.
