"""Read-only, pre-entry estimate for ordinary SPL mints. Units are raw tokens."""
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPException
import json
import time
from urllib.request import Request, urlopen

RPC = 'https://api.mainnet-beta.solana.com'
TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
DIGITS = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
P = 2**255 - 19
D = -121665 * pow(121666, -1, P) % P
MAX_AGE = 120
# Pre-registered paper hypotheses, expressed in basis points.
HIGH_BPS = 2000
LARGE_LOSS_BPS = 3000


def signer_address(address):
    """Exclude off-curve program authorities. An on-curve key can still be custodial."""
    if not isinstance(address, str) or not 32 <= len(address) <= 44:
        raise ValueError('invalid owner address')
    n = 0
    for char in address:
        n = n * 58 + DIGITS.index(char)
    raw = bytes(len(address) - len(address.lstrip('1'))) + n.to_bytes((n.bit_length()+7)//8, 'big')
    if len(raw) != 32:
        raise ValueError('invalid owner bytes')
    value = int.from_bytes(raw, 'little')
    y = value % (1 << 255)
    if y >= P:
        return False
    denominator = (1 + D*y*y) % P
    if not denominator:
        return False
    square = (y*y-1) * pow(denominator, -1, P) % P
    return (value >> 255 == 0) if square == 0 else pow(square, (P-1)//2, P) == 1


def rpc(method, params):
    payload = json.dumps(dict(jsonrpc='2.0', id=1, method=method, params=params)).encode()
    request = Request(RPC, data=payload, headers={'Content-Type': 'application/json'})
    with urlopen(request, timeout=5) as response:
        body = json.load(response)
    if 'error' in body:
        raise ValueError('rpcError')
    return body['result']


def measure(mint, read=rpc):
    opts = {'commitment': 'finalized'}
    listing = read('getTokenLargestAccounts', [mint, opts])
    keys = [item['address'] for item in listing['value']]
    if not 0 < len(keys) <= 20 or len(set(keys)) != len(keys) or mint in keys:
        raise ValueError('invalid sample')
    slot = listing['context']['slot']
    batch = read('getMultipleAccounts', [[mint, *keys],
                 dict(opts, encoding='jsonParsed', minContextSlot=slot)])
    values = batch['value']
    if batch['context']['slot'] < slot or len(values) != 1 + len(keys):
        raise ValueError('invalid batch')
    def info(row, kind):
        if not row or row['owner'] != TOKEN or row['data']['parsed']['type'] != kind:
            raise ValueError('unsupported account')
        return row['data']['parsed']['info']
    supply = int(info(values[0], 'mint')['supply'])
    amounts = Counter()
    sampled = 0
    for row in values[1:]:
        account = info(row, 'account')
        amount = int(account['tokenAmount']['amount'])
        if account['mint'] != mint or amount < 0:
            raise ValueError('invalid token amount')
        sampled += amount
        if amount and account['owner'] not in ('1'*32, '1nc1nerator11111111111111111111111111111111') and signer_address(account['owner']):
            amounts[account['owner']] += amount
    if len(amounts) < 10:
        raise ValueError('fewer than ten observed signer addresses')
    if not amounts or not 0 < sampled <= supply:
        raise ValueError('insufficient sample')
    return dict(slot=batch['context']['slot'], sampleAccounts=len(keys), observedOwners=len(amounts),
                largestOwnerBps=max(amounts.values())*10000//supply,
                sampledSupplyBps=sampled*10000//supply)


def capture(mint):
    started = time.time()
    try:
        data = measure(mint)
    except (ValueError, TypeError, KeyError, OSError, HTTPException) as exc:
        data = dict(error=str(getattr(exc, 'code', None) or type(exc).__name__))
    return dict(data, startedAt=started, receivedAt=time.time())


class HolderSampler:
    def __init__(self):
        self.pool = ThreadPoolExecutor(max_workers=2)
        self.pending = {}
        self.latest = {}

    def refresh(self, mint):
        previous = self.pending.get(mint)
        if previous and not previous.done():
            return
        if previous:
            self.latest[mint] = previous.result()
        self.pending[mint] = self.pool.submit(capture, mint)

    def at_entry(self, mint, cutoff):
        pending = self.pending.get(mint)
        data = pending.result() if pending and pending.done() else self.latest.get(mint)
        if not data:
            return dict(state='unknown', reason='pending')
        if not cutoff-MAX_AGE <= data['startedAt'] <= data['receivedAt'] <= cutoff:
            return dict(data, state='unknown', reason='staleOrLate')
        if 'error' in data:
            return dict(data, state='unknown', reason='sourceUnavailable')
        return dict(data, state='high' if data['largestOwnerBps'] >= HIGH_BPS else 'belowThreshold')
