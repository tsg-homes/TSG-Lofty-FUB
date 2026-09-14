# 2026-09-14 - Lofty vs TSG Score Audit

FUB population source: LFC FUB Cache tab snapshot (2026-09-10 12:57Z) - NOT a live API pull (8584 people).
Current-formula source: ClientTierScoring.gs v2.1 output - Readiness Audit tab (Formula v2.1 - percentile/comparative, 2026-09-11T19:43:42.839Z); fallback Score Write Log 2026-09-07 LIVE write (ID-keyed, 2238 people).
Legacy Lofty score source: LFC Comm Audit tab, unlabeled col 10 = Lofty API `score` at audit time (verified against enrichment Preview notes).
Legacy Lofty tier source: FUB grade tag A/A+/B/C/D carried over at import, else Tag column of the Lofty exports held in Drive.

FUB contacts carrying a Lofty legacy score and/or tier: 5974
  Matched (confident): 5690
    with a numeric Lofty score: 5481
    with a Lofty grade tier:    815
    with a v2.1 score (9/11):   5690
    tier moved:                 660
  Unresolved / low-confidence: 284

Unresolved reasons: NAME-DISAGREE=962, AMBIGUOUS-LOFTY-SCORE=174, NAME-COLLISION=70, QA-TEST=14, AMBIGUOUS-LOFTY-GRADE=7, TIER-SOURCE-DISAGREE=1

Legacy tier distribution (matched): A=415, A+=93, A/A+=1, A/B=7, A/C=4, B=155, C=139, D=1
Current v2.1 tier distribution (matched): B=5655, C=35
Tier moves: YES (A -> B)=396, YES (C -> B)=139, YES (A+ -> B)=88, YES (A -> C)=19, YES (A/B -> B)=7, YES (A+ -> C)=5, YES (A/C -> B)=4, YES (A/A+ -> B)=1, YES (D -> B)=1
