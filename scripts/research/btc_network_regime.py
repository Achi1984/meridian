"""Exploratory association of lagged active address breadth with next daily BTC return."""
import argparse
import csv
from datetime import date,timedelta
import json
from pathlib import Path
from statistics import mean,median

DAY=timedelta(days=1)


def analyse(path):
    with path.open() as f:
        rows={date.fromisoformat(r['time']):r for r in csv.DictReader(f)}
    results={}
    for year in (2024,2025):
        start=date(year,5,1)
        stop=date(year+1,5,1)
        values={'above':[],'other':[]}
        missed=0
        for offset in range((stop-start).days):
            t=start+offset*DAY
            try:
                # Leave a full calendar day between the last metric and the price anchor.
                addresses=[int(rows[t-i*DAY]['AdrActCnt']) for i in range(2,32)]
                p,q=[float(rows[x]['PriceUSD']) for x in (t,t+DAY)]
                if min(addresses)<=0 or min(p,q)<=0:
                    raise ValueError('nonpositive')
                group='above' if mean(addresses[:7])>mean(addresses) else 'other'
                values[group].append(100*(q/p-1))
            except (KeyError,ValueError):
                missed+=1
        results[str(start)]={'missing':missed,'groups':{k:dict(n=len(v),meanPct=mean(v),medianPct=median(v)) for k,v in values.items() if v}}
    return results


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('csv',type=Path)
    print(json.dumps(analyse(p.parse_args().csv),indent=2))
