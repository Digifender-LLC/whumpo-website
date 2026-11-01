import {emptyLedger,type Ledger} from './capacity-ledger';

// WH-043: the persistent form of the capacity ledger. One row per account holds the plain-data ledger state; every change is a compare-and-set on `revision`, so two writers that
// started from the same state cannot both win (the loser gets a 409 and re-reads). The pure operations in capacity-ledger.ts stay the only place that changes a balance. Nothing here is
// wired to a route, invoice, grant or admission path, and the state is bounded (1 MiB in the schema): a long-lived ledger needs compaction before that limit, which is not built.
export class CapacityStoreError extends Error {
 constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = 'CapacityStoreError'; }
}
const now = () => Math.floor(Date.now() / 1000);
/** The saved ledger, or an empty one at revision 0 when the account has none yet. */
export async function loadLedger(db: D1Database, userId: string): Promise<{ ledger: Ledger; revision: number }> {
 const row = await db.prepare('SELECT revision,state_json FROM capacity_ledgers WHERE user_id=?').bind(userId).first<{ revision: number; state_json: string }>();
 if (!row) return { ledger: emptyLedger(), revision: 0 };
 const ledger = JSON.parse(row.state_json) as Ledger;
 if (ledger.version !== 1 || ledger.terms !== 'synthetic-proposal') throw new CapacityStoreError(500, 'ledger_unreadable', 'The saved capacity ledger is not a version this build reads.');
 return { ledger, revision: row.revision };
}
/** Apply one pure ledger operation to the saved state. `change` returns the operation's result; a refused operation throws and nothing is written. */
export async function updateLedger<T extends { ledger: Ledger }>(db: D1Database, userId: string, change: (ledger: Ledger) => T): Promise<T & { revision: number }> {
 const { ledger, revision } = await loadLedger(db, userId);
 const result = change(ledger);
 const text = JSON.stringify(result.ledger);
 if (result.ledger === ledger) return { ...result, revision };
 const write = revision === 0
  ? await db.prepare('INSERT INTO capacity_ledgers(user_id,revision,state_json,updated_at) VALUES(?,1,?,?) ON CONFLICT(user_id) DO NOTHING').bind(userId, text, now()).run()
  : await db.prepare('UPDATE capacity_ledgers SET revision=revision+1,state_json=?,updated_at=? WHERE user_id=? AND revision=?').bind(text, now(), userId, revision).run();
 if (!write.meta?.changes) throw new CapacityStoreError(409, 'revision_conflict', 'The capacity ledger changed while this request ran. Read it again and retry.');
 return { ...result, revision: revision + 1 };
}
