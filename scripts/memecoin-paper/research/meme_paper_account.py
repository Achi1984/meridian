"""Integer-unit, long-only paper account for one Solana discovery cohort."""
import sqlite3

UNIT = 1_000_000
START = 1000*UNIT
SIZE = 20*UNIT
FEE = UNIT//20
MAX_OPEN = 3


class MemeAccount:
    def __init__(self, path):
        self.db = sqlite3.connect(path, isolation_level='IMMEDIATE')
        self.db.row_factory = sqlite3.Row
        self.db.execute("""CREATE TABLE IF NOT EXISTS positions(
            mint TEXT PRIMARY KEY, pool TEXT NOT NULL, opened INTEGER NOT NULL,
            qty TEXT NOT NULL, debit INTEGER NOT NULL, marked INTEGER, mark_at INTEGER,
            peak INTEGER NOT NULL, quote_missing INTEGER NOT NULL DEFAULT 0,
            closed INTEGER, credit INTEGER, reason TEXT)""")
        self.db.commit()

    def _cash(self):
        return START+self.db.execute('SELECT COALESCE(SUM(COALESCE(credit,0)-debit),0) FROM positions').fetchone()[0]

    def active(self):
        return [dict(r) for r in self.db.execute('SELECT * FROM positions WHERE closed IS NULL ORDER BY opened,mint')]

    def buy(self, mint, pool, qty, sell, now):
        if now%86400 >= 86400-20*60:
            return False
        if type(qty) is not int or type(sell) is not int or qty <= 0 or sell*100 < SIZE*95:
            return False
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            if (self._cash()<SIZE+FEE or len(self.active())>=MAX_OPEN or
                    self.db.execute('SELECT 1 FROM positions WHERE mint=?',(mint,)).fetchone()):
                return False
            self.db.execute('INSERT INTO positions(mint,pool,opened,qty,debit,marked,mark_at,peak) VALUES(?,?,?,?,?,?,?,?)',
                            (mint,pool,now,str(qty),SIZE+FEE,sell-FEE,now,sell-FEE))
        return True

    def observe(self, mint, sell, now, final=False):
        """A missing quote invalidates the current valuation. Exit at observed quote."""
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            p = self.db.execute('SELECT * FROM positions WHERE mint=? AND closed IS NULL',(mint,)).fetchone()
            if p is None or now < p['mark_at']:
                return None
            if sell is None:
                self.db.execute('UPDATE positions SET marked=NULL,mark_at=?,quote_missing=1 WHERE mint=?',
                                (now,mint))
                return None
            if type(sell) is not int or sell <= 0:
                raise ValueError('Invalid raw USDC exit quote')
            value = sell-FEE
            peak = max(value,p['peak'])
            reason = None
            if value*100 <= p['debit']*94:
                reason = 'stop'
            elif peak*100 >= p['debit']*112 and value*100 <= peak*94:
                reason = 'trailingStop'
            elif now//86400 != p['opened']//86400 or now%86400 >= 86400-5*60:
                reason = 'dayClose'
            elif now-p['opened'] >= 900:
                reason = 'time'
            elif final:
                reason = 'pilotEnd'
            self.db.execute('UPDATE positions SET marked=?,mark_at=?,peak=?,quote_missing=0 WHERE mint=?',
                            (value,now,peak,mint))
            if reason:
                self.db.execute('UPDATE positions SET closed=?,credit=?,reason=? WHERE mint=?',
                                (now,value,reason,mint))
            return reason

    def status(self, now):
        active = self.active()
        closed, realized = self.db.execute('SELECT COUNT(*),COALESCE(SUM(credit-debit),0) FROM positions WHERE closed IS NOT NULL').fetchone()
        unknown = sum(p['quote_missing'] or now-p['mark_at']>120 for p in active)
        cash = self._cash()
        equity = None if unknown else (cash+sum(p['marked'] for p in active))/UNIT
        return dict(startUsdc=START/UNIT,cashUsdc=cash/UNIT,openPositions=len(active),closedTrades=closed,
                    realizedPnlUsdc=realized/UNIT,unpricedPositions=unknown,equityUsdc=equity,
                    openCostUsdc=sum(p['debit'] for p in active)/UNIT)

    def close(self):
        self.db.close()
