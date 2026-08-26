// @ts-nocheck
'use client';

import { useChat } from '@ai-sdk/react';
import { useEffect, useRef } from 'react';
import styles from './AIPanel.module.css';

interface AIPanelProps {
  onStrategyGenerated?: (code: string) => void;
  onBacktestCompleted?: (metrics: any, bars: any) => void;
}

export function AIPanel({ onStrategyGenerated, onBacktestCompleted }: AIPanelProps) {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/agent',
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className={styles.container}>
      <div className={styles.messages}>
        {messages.length === 0 && (
          <div className={styles.message} style={{ color: 'var(--text-secondary)' }}>
            Hello! I am your AI Quantitative Research Agent. State an objective (e.g. "Create a moving average crossover strategy") and I will write the code and run a backtest.
          </div>
        )}
        
        {messages.map(m => (
          <div key={m.id} className={`${styles.message} ${m.role === 'user' ? styles.userMessage : styles.assistantMessage}`}>
            <div>{m.content}</div>
            
            {/* Display tool calls if they exist */}
            {m.toolInvocations?.map(toolInvocation => {
              const toolCallId = toolInvocation.toolCallId;
              const toolName = toolInvocation.toolName;
              
              // If the AI called validate_strategy or run_backtest, we can show it
              if ('result' in toolInvocation) {
                // Side-effect: update the editor and UI when backtest completes
                if (toolName === 'run_backtest' && toolInvocation.result?.success) {
                  // We do this in a timeout to avoid React render cycle warnings
                  setTimeout(() => {
                    if (toolInvocation.args?.sourceCode && onStrategyGenerated) {
                      onStrategyGenerated(toolInvocation.args.sourceCode);
                    }
                    if (onBacktestCompleted) {
                      // Note: We'd ideally return the bars from the AI tool, but for now we just 
                      // let the UI re-run it or we fetch it. Since the tool result didn't include bars 
                      // to save bandwidth, we'll let the user click "Run Backtest" or we trigger it.
                    }
                  }, 0);
                }

                return (
                  <div key={toolCallId} className={styles.toolCall}>
                    <strong>✓ Completed: {toolName}</strong>
                    {toolName === 'run_backtest' && toolInvocation.result?.metrics && (
                      <div style={{ marginTop: '4px' }}>
                        Net Profit: {toolInvocation.result.metrics.net_profit.toFixed(2)}
                      </div>
                    )}
                  </div>
                );
              } else {
                return (
                  <div key={toolCallId} className={styles.toolCall}>
                    <strong>Executing: {toolName}...</strong>
                  </div>
                );
              }
            })}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className={styles.inputForm}>
        <input
          className={styles.input}
          value={input}
          onChange={handleInputChange}
          placeholder="Ask the AI to research a strategy..."
          disabled={isLoading}
        />
        <button type="submit" className={styles.sendButton} disabled={isLoading || !(input || '').trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
