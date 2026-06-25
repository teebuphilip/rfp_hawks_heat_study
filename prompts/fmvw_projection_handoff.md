# FMVW Projection Handoff

## Goal
Finish the standalone `Fair Market Value Methodology` site so the `FMVW View` can be used to compare two players and show a teammate-neutral 26-27 projection block underneath.

## Current Repo
- Standalone repo: `/Users/teebuphilip/Documents/work/rfp_hawks_heat_study`
- Public routes:
  - `/` hub
  - `/fmvw/` player comparator
  - `/process/` methodology

## FMVW Page Shape
- Two dropdowns:
  - `Player A`
  - `Player B`
- One action button:
  - `Compare Players`
- Comparison table:
  - player A / player B
  - FMV
  - wins-equivalent
  - HBB factor
  - HBB-adjusted wins
- Summary block below the table:
  - left / right
  - base gap
  - HBB gap
- Projection block below summary:
  - `DBB2 Teammate-Neutral Projection 26-27`
  - loaded from `data/fmvw_projection_26_27.json`
  - top 5 rows shown in a compact table

## Fixed Inputs
- Player pool:
  - `data/fmvw_top200_2526.csv`
- Projection feed:
  - `data/fmvw_projection_26_27.json`
- League HBB lookup:
  - `data/league_table.json`

## Definitions To Keep
- Teammate-neutral evaluation
- FMV
- FMVW
- HBB
- Band

## Required Plain-English Behavior
- HBB should be explained as a team-context multiplier.
- Band should be explained as the salary tier derived from FMV.
- The page should stay neutral and not use personal names in the visible copy.

## Open Item
- If the 26-27 projection feed changes, keep the summary sentence and the top-5 projection table synced with the JSON file.
