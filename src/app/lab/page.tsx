'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from './page.module.css';

interface Strategy {
  id: number;
  name: string;
  description: string;
  updatedAt: string;
  versions: {
    id: number;
    versionStr: string;
    status: string;
    hypothesis: string;
  }[];
}

export default function Lab() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchStrategies() {
      try {
        const res = await fetch('/api/strategies');
        if (res.ok) {
          const data = await res.json();
          setStrategies(data);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchStrategies();
  }, []);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <Link href="/" className={styles.logo}>
          AI<span>Pine</span> Platform
        </Link>
        <nav className={styles.nav}>
          <Link href="/" className={styles.navLink}>Terminal</Link>
          <Link href="/lab" className={styles.navLink} style={{ color: 'var(--text-primary)' }}>Strategy Lab</Link>
        </nav>
      </header>

      <main className={styles.main}>
        <h1 className={styles.pageTitle}>Strategy Laboratory</h1>
        
        <div className={styles.leaderboard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Strategy Name</th>
                <th>Latest Version</th>
                <th>Status</th>
                <th>Hypothesis</th>
                <th>Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center' }}>Loading strategies... (Ensure Database is running)</td>
                </tr>
              ) : strategies.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center' }}>No strategies found. Go to the Terminal to create one.</td>
                </tr>
              ) : (
                strategies.map((strategy) => {
                  const latestVersion = strategy.versions[0];
                  return (
                    <tr key={strategy.id}>
                      <td>
                        <Link href="/" className={styles.strategyName}>
                          {strategy.name}
                        </Link>
                      </td>
                      <td>
                        {latestVersion?.versionStr || 'N/A'}
                      </td>
                      <td className={
                        latestVersion?.status === 'robust' ? styles.statusRobust :
                        latestVersion?.status === 'rejected' ? styles.statusRejected :
                        styles.statusCandidate
                      }>
                        {latestVersion?.status?.toUpperCase() || 'CANDIDATE'}
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>
                        {latestVersion?.hypothesis || '-'}
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>
                        {new Date(strategy.updatedAt).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
