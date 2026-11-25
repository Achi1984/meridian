"""Compare official monthly October funding times and rates to the supplemental API."""
import csv
import io
import json
import sys
import zipfile
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from hashlib import sha256
from pathlib import Path
from lowvol_funding_probe import ASSETS, probe
from taker_flow_replay import download

START=1792195200000  # October 17, 00:00 UTC
END=START+7*86400000


def check(asset):
    symbol=asset+'USDT'
    url=f'https://data.binance.vision/data/futures/um/monthly/fundingRate/{symbol}/{symbol}-fundingRate-2026-10.zip'
    raw=download(url)
    digest=sha256(raw).hexdigest()
    if digest!=download(url+'.CHECKSUM').decode().split()[0]:
        raise ValueError('archive checksum mismatch')
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        rows=list(csv.DictReader(io.StringIO(z.read(z.namelist()[0]).decode('utf-8-sig'))))
    reference={int(r['calc_time']):(Decimal(r['last_funding_rate']),int(r['funding_interval_hours']))
               for r in rows if START<=int(r['calc_time'])<=END}
    api=probe(asset,START,END)
    events={t:Decimal(v) for t,v in api['fundingEvents']}
    common=reference.keys() & events.keys()
    return dict(asset=asset,archiveSHA256=digest,reference=len(reference),api=len(events),
                exactTimes=len(common),exactRates=sum(reference[t][0]==events[t] for t in common),
                archiveIntervalsHours=sorted({v[1] for v in reference.values()}))


if __name__=='__main__':
    with ThreadPoolExecutor(4) as workers:
        result=list(workers.map(check,ASSETS))
    Path(sys.argv[1]).write_text(json.dumps(dict(startMs=START,endMs=END,assets=result),indent=2)+'\n')
    print([(r['asset'],r['reference'],r['api'],r['exactTimes'],r['exactRates']) for r in result])
