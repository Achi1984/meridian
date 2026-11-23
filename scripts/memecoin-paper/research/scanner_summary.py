"""Render scanner journal leaderboards for the Actions run summary."""
import json
import sys

from newcomer_scanner import WINDOWS


def render(events):
    events = list(events)
    momentum = next((e for e in reversed(events) if e['event'] == 'momentumSummary'), None)
    if momentum:
        print('### 20 USDC volume momentum (paper)')
        print(f"Shortlisted {momentum['shortlisted']}, comparable {momentum['comparable']}, excluded {momentum['excluded']}.")
        print('| Arm | Closed | Open | Realized USDC | Without best mint |')
        print('|---|---:|---:|---:|---:|')
        for label in ('standard', 'filterOnly', 'filterAndFade'):
            arm = momentum[label]
            print(f"| {label} | {arm['closed']} | {arm['unresolved']} | {arm['netUsdc']} | {arm['withoutBestUsdc']} |")
        for label in ('filterComparison', 'exitComparison', 'oneQuoteLater'):
            print(f"\n{label}: `{json.dumps(momentum[label])}`")
    summaries = [e for e in events if e['event'] == 'scannerSummary']
    if not summaries:
        print('Scanner incomplete. No verified leaderboard.')
        return
    summary = summaries[-1]
    print(f"Sampled {summary['sampled']} mints; qualified {summary['qualified']}. {summary['scope']}.")
    candidates = [e for e in events if e['event'] == 'scannerCandidate' and e['asOf'] == summary['asOf']]
    for minutes in WINDOWS:
        window = str(minutes)
        print(f'### Top 10 · {minutes} min')
        print('| Rank | Mint | Volume USD | Change % | Buyers | Net resale of 20 USDC | Decision |')
        print('|---:|---|---:|---:|---:|---:|---|')
        ranked = [e for e in candidates if window in e['ranks']]
        for e in sorted(ranked, key=lambda e: e['ranks'][window]):
            data = e['windows'][window]
            def fmt(value):
                return '—' if value is None else f'{value:,.2f}'
            buyers = data['uniqueBuyers']
            mint = e['row']['mint']
            print(f"| {e['ranks'][window]} | [{mint}](https://jup.ag/tokens/{mint}) "
                  f"| {fmt(data['volumeUsd'])} | {fmt(data['changePct'])} "
                  f"| {buyers if buyers is not None else '—'} | {fmt(e.get('netResaleUsdc'))} "
                  f"| {', '.join(e['reasons']) or 'paper shortlist'} |")
        if not ranked:
            print('\nNo eligible observations.')
        print()


if __name__ == '__main__':
    with open(sys.argv[1]) as journal:
        render(json.loads(line) for line in journal if line.strip())
