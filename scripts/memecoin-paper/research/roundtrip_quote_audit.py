"""Observe expected and conservative round-trip quotes for the same 20 USDC buy."""
import argparse
import json
import time

from meme_paper_account import FEE
from new_pool_watch import ADDRESS, SIZE, USDC, spot_quote_amounts


def observe(mint, quote=spot_quote_amounts, clock=time.time, size=SIZE):
    if mint == USDC or not ADDRESS.fullmatch(mint):
        raise ValueError('invalid target mint')
    start = clock()
    buy, buy_floor = quote(USDC, mint, size)
    expected, sell_floor = quote(mint, USDC, buy)
    if buy == buy_floor:
        conservative_expected, minimum = expected, sell_floor
    else:
        conservative_expected, minimum = quote(mint, USDC, buy_floor)
    finish = clock()
    if not 0 <= finish-start <= 30:
        raise ValueError('quote window exceeds 30 seconds')
    return dict(mint=mint, start=start, finish=finish, inputRaw=size, feesRaw=2*FEE,
                expectedBuyQty=buy, minimumBuyQty=buy_floor,
                expectedResaleRaw=expected, expectedResaleOfMinimumQtyRaw=conservative_expected,
                minimumResaleOfMinimumQtyRaw=minimum,
                expectedLossPct=100*(size+2*FEE-expected)/size,
                conservativeLossPct=100*(size+2*FEE-minimum)/size)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mint', nargs='+')
    for mint in dict.fromkeys(parser.parse_args().mint):
        try:
            row = observe(mint)
        except (ValueError, KeyError, OSError, TypeError) as exc:
            row = dict(mint=mint, error=str(exc))
        print(json.dumps(row), flush=True)
