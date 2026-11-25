"""Public quote-only size ladder, with reversed order after a thirty-second pause."""
import argparse
import json
import time
from roundtrip_quote_audit import observe


def ladder(mint):
    rounds=[]
    for order in ((10,20,40),(40,20,10)):
        if rounds:
            time.sleep(30)
        samples={}
        for size in order:
            try:
                samples[size]=observe(mint,size=size*1_000_000)
            except (ValueError,OSError,KeyError,TypeError) as exc:
                samples[size]=dict(error=str(exc),at=time.time())
        rounds.append(samples)
    return dict(mint=mint,rounds=rounds)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mint')
    print(json.dumps(ladder(parser.parse_args().mint)))
