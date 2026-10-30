export const WALLET_SCOPE='PIONEX_WALLET_FUTURES_GRID_V1';
export const OVERWRITE_SCOPES=['WALLET_FUTURES_GRID','PRIMARY_BOT_API','NONE'];
export const EXCLUDED_SCOPES=['KNOWN_EXCLUDED_PRODUCTS','UNVERIFIED','NONE'];
const REASONS=[
  'UNSUPPORTED_SCOPE','SUPPORTED_HYDRATION_MISSING','SANITIZATION_LOSS_OR_DUPLICATE',
  'PAGINATION_INCOMPLETE','EXPLICIT_PARTIAL','SYNC_PARTIAL','DETAILS_INCOMPLETE',
  'SOURCE_STATUS_NOT_OK','SOURCE_STALE','SOURCE_UNAVAILABLE'
];
export function safeOverwriteRejectionReasons(value){
  return Array.isArray(value)?[...new Set(value.slice(0,REASONS.length)
    .filter(reason=>REASONS.includes(reason)))]:[];
}
export function safeScopeCount(value){
  return Number.isSafeInteger(value)&&value>=0&&value<=1_000_000?value:null;
}
function safeCategoryShape(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  return {
    countKind:['MISSING','NULL','NUMBER','STRING','BOOLEAN','OTHER'].includes(value.countKind)?value.countKind:null,
    zeroVerified:typeof value.zeroVerified==='boolean'?value.zeroVerified:null,
    listKind:['MISSING','NULL','ARRAY','OTHER'].includes(value.listKind)?value.listKind:null,
    listEmpty:typeof value.listEmpty==='boolean'?value.listEmpty:null,
    hasMoreFalse:typeof value.hasMoreFalse==='boolean'?value.hasMoreFalse:null
  };
}
export function safeScopeDiagnostics(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const flags=['scopePresent','schemaOk','botTypeOk','exclusionsVerified',
    'excludedRowsEqualsUnsupported','categoriesVerified','countsVerified'];
  return {
    ...Object.fromEntries(flags.map(key=>[key,typeof value[key]==='boolean'?value[key]:null])),
    candidateCount:safeScopeCount(value.candidateCount),
    unsupportedCount:safeScopeCount(value.unsupportedCount),
    unrecognizedNonemptyCategoryCount:safeScopeCount(value.unrecognizedNonemptyCategoryCount),
    unverifiedCategoryShape:safeCategoryShape(value.unverifiedCategoryShape),
    typeCounts:Object.fromEntries(['futures_grid','futures_lite','OTHER'].map(key=>
      [key,safeScopeCount(value.typeCounts?.[key])]))
  };
}
