"""Frozen Cross-Sectional Perpetual Factor V1 validation wrapper. Research only."""

from self_history_perp_factor_v3 import (
    DISCOVERY_ASSETS,
    TRANSFER_ASSETS,
    FACTORS,
    BASE_COST_BPS,
    STRESS_COST_BPS,
    prepare_dataset,
    build_factor_panel,
    run_method,
)

RULESET='CROSS-SECTIONAL-PERPETUAL-FACTOR-V1-FROZEN'

TEMPORAL_GATE={
    'min_periods':75,
    'min_active':45,
    'min_factor_active':30,
    'min_pf':1.05,
    'min_sharpe':0.50,
    'max_dd_pct':20.0,
    'min_positive_windows':3,
    'min_positive_assets':6,
    'max_positive_concentration_pct':40.0,
    'min_positive_factor_books':2,
}

TRANSFER_GATE={
    'min_periods':150,
    'min_active':70,
    'min_factor_active':45,
    'min_pf':1.05,
    'min_sharpe':0.50,
    'max_dd_pct':25.0,
    'min_positive_windows':3,
    'min_positive_assets':3,
    'max_positive_concentration_pct':50.0,
    'min_positive_factor_books':2,
}

def validation_gate(result, stress, gate, stage):
    reasons=[]
    if result['periods']<gate['min_periods']:
        reasons.append('PERIODS_LT_'+str(gate['min_periods']))
    if result['activeWeeks']<gate['min_active']:
        reasons.append('ACTIVE_WEEKS_LT_'+str(gate['min_active']))
    for f in FACTORS:
        if result['factorBooks'][f]['activeWeeks']<gate['min_factor_active']:
            reasons.append(f+':ACTIVE_LT_'+str(gate['min_factor_active']))
    if result['returnPct']<=0:
        reasons.append('RETURN_NOT_POSITIVE')
    if result['priceOnlyReturnPct']<=0:
        reasons.append('PRICE_ONLY_NOT_POSITIVE')
    if result['profitFactor']<gate['min_pf']:
        reasons.append('PF_LT_'+str(gate['min_pf']))
    if result['sharpe']<gate['min_sharpe']:
        reasons.append('SHARPE_LT_'+str(gate['min_sharpe']))
    if result['maxDrawdownPct']>gate['max_dd_pct']:
        reasons.append('DD_GT_'+str(gate['max_dd_pct']))
    if result['positiveWindows']<gate['min_positive_windows']:
        reasons.append('POSITIVE_WINDOWS_LT_'+str(gate['min_positive_windows']))
    if result['longContribution']<=0:
        reasons.append('LONG_CONTRIBUTION_NOT_POSITIVE')
    if result['shortContribution']<=0:
        reasons.append('SHORT_CONTRIBUTION_NOT_POSITIVE')
    if result['positiveAssets']<gate['min_positive_assets']:
        reasons.append('POSITIVE_ASSETS_LT_'+str(gate['min_positive_assets']))
    if result['positiveConcentrationPct']>gate['max_positive_concentration_pct']:
        reasons.append('POSITIVE_CONCENTRATION_GT_'+str(gate['max_positive_concentration_pct']))
    if stress['returnPct']<=0:
        reasons.append('STRESS_RETURN_NOT_POSITIVE')
    positive_books=sum(1 for f in FACTORS if result['factorBooks'][f]['returnPct']>0)
    if positive_books<gate['min_positive_factor_books']:
        reasons.append('POSITIVE_FACTOR_BOOKS_LT_'+str(gate['min_positive_factor_books']))

    if stage=='TEMPORAL':
        decision='TEMPORAL_VALIDATION_PASS_TRANSFER_REQUIRED' if not reasons else 'TEMPORAL_VALIDATION_FAIL_RESEARCH_REDESIGN'
    elif stage=='TRANSFER':
        decision='TRANSFER_VALIDATION_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY' if not reasons else 'TRANSFER_VALIDATION_FAIL_RESEARCH_REDESIGN'
    else:
        raise ValueError('unsupported stage')

    return {
        'pass':not reasons,
        'reasons':reasons,
        'positiveFactorBooks':positive_books,
        'decision':decision,
    }

def _run(raw_by_asset, assets, start, end, transfer, stage, gate):
    try:
        dataset=prepare_dataset({a:raw_by_asset[a] for a in assets})
        panel=build_factor_panel(dataset,assets,start,end)
        base=run_method(dataset,panel,assets,start,end,'XSEC',transfer,BASE_COST_BPS)
        stress=run_method(dataset,panel,assets,start,end,'XSEC',transfer,STRESS_COST_BPS)
        verdict=validation_gate(base,stress,gate,stage)
        return {
            'ruleset':RULESET,
            'stage':stage,
            'researchOnly':True,
            'executionImpact':False,
            'autoPromotion':False,
            'dataIntegrityFailure':False,
            'result':base,
            'stress':stress,
            'gate':verdict,
            'decision':verdict['decision'],
        }
    except Exception as e:
        decision='TEMPORAL_VALIDATION_FAIL_RESEARCH_REDESIGN' if stage=='TEMPORAL' else 'TRANSFER_VALIDATION_FAIL_RESEARCH_REDESIGN'
        return {
            'ruleset':RULESET,
            'stage':stage,
            'researchOnly':True,
            'executionImpact':False,
            'autoPromotion':False,
            'dataIntegrityFailure':True,
            'error':str(e),
            'gate':{'pass':False,'reasons':['DATA_INTEGRITY_FAILURE']},
            'decision':decision,
        }

def run_temporal_validation(raw_by_asset,start,end):
    return _run(raw_by_asset,DISCOVERY_ASSETS,start,end,False,'TEMPORAL',TEMPORAL_GATE)

def run_transfer_validation(raw_by_asset,start,end):
    return _run(raw_by_asset,TRANSFER_ASSETS,start,end,True,'TRANSFER',TRANSFER_GATE)
