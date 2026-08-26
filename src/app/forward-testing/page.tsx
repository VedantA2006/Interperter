import Link from 'next/link';
import { readDb } from '@/db/localStore';
import styles from '../lab/page.module.css';

export default async function ForwardTesting() {
  let results: any[] = [];
  try {
    const db = await readDb();
    
    results = db.forwardTestResults.map(r => {
      const version = db.strategyVersions.find(v => v.id === r.versionId);
      const strategy = version ? db.strategies.find(s => s.id === version.strategyId) : null;
      
      return {
        id: r.id,
        tradeId: r.tradeId,
        expectedPrice: r.expectedPrice,
        actualPrice: r.actualPrice,
        consistencyScore: r.consistencyScore,
        createdAt: r.createdAt,
        versionStr: version ? version.versionStr : 'Unknown',
        strategyName: strategy ? strategy.name : 'Unknown',
      };
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
  } catch (error) {
    console.error('Error fetching forward testing results:', error);
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <Link href="/" className={styles.logo}>
          AI<span>Pine</span> Platform
        </Link>
        <nav className={styles.nav}>
          <Link href="/" className={styles.navLink}>Terminal</Link>
          <Link href="/lab" className={styles.navLink}>Strategy Lab</Link>
          <Link href="/forward-testing" className={styles.navLink} style={{ color: 'var(--text-primary)' }}>Forward Testing</Link>
        </nav>
      </header>

      <main className={styles.main}>
        <h1 className={styles.pageTitle}>Forward Testing Results</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
          Real-time webhook trade execution vs Expected backtest execution
        </p>
        
        <div className={styles.leaderboard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Strategy</th>
                <th>Version</th>
                <th>Trade ID</th>
                <th>Expected Price</th>
                <th>Actual Price</th>
                <th>Consistency Score</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {results.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '24px' }}>
                    No forward testing data available. Send a webhook to /api/webhooks/tradingview.
                  </td>
                </tr>
              ) : (
                results.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{r.strategyName}</td>
                    <td>{r.versionStr}</td>
                    <td>{r.tradeId}</td>
                    <td>{r.expectedPrice}</td>
                    <td>{r.actualPrice}</td>
                    <td style={{ color: r.consistencyScore && r.consistencyScore > 90 ? 'var(--robust-green)' : 'var(--reject-red)' }}>
                      {r.consistencyScore ? r.consistencyScore.toFixed(2) + '%' : 'N/A'}
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
