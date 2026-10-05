export const CROSS_VENUE_FUNDING_EDGE_V2_STAGE_LOCK=Object.freeze({
  ruleset:'CROSS-VENUE-FUNDING-EDGE-V2',
  stage:'SOURCE_AUDIT',
  sourceAudit:true,
  discovery:false,
  validation:false,
  holdout:false,
  paper:false,
  live:false,
  predecessor:'CROSS-VENUE-FUNDING-EDGE-V1',
  predecessorDecision:'CROSS_VENUE_V1_SOURCE_FAIL'
});
