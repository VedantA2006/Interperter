// @ts-nocheck
'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import styles from './page.module.css';
import { StrategyTester, BacktestMetrics } from '@/components/StrategyTester';
import type { DatasetInfo } from '@/components/Chart';

const PineEditor = dynamic(() => import('@/components/PineEditor').then(mod => mod.PineEditor), { ssr: false });
const Chart = dynamic(() => import('@/components/Chart').then(mod => mod.Chart), { ssr: false });

const DEFAULT_CODE = `
// This source code is subject to the terms of the Mozilla Public License 2.0
// © EVLabs
//@version=6
indicator("Liquidity Sweep Signals", shorttitle="LSS", overlay=true,
         max_labels_count=300, max_lines_count=300, max_boxes_count=300)

// ─── Inputs ───────────────────────────────────────────────────────────────────
swingLen   = input.int(10,    "Swing Length",              minval=3,  maxval=50,  group="Detection")
maxLevels  = input.int(5,     "Max Liq Levels",            minval=1,  maxval=10,  group="Detection")
atrMult    = input.float(0.5, "SL ATR Buffer",             minval=0.1, step=0.1,  group="Risk")
rrRatio    = input.float(2.0, "R:R Ratio",                 minval=0.5, step=0.1,  group="Risk")
expireBars = input.int(30,    "Expire setup after N bars", minval=3,  maxval=200, group="Risk")
statsLen   = input.int(20,    "Stats: Last N Signals",     minval=5,  maxval=100, group="Stats")
showDebug  = input.bool(true, "Show setup markers",        group="Stats")
sessionLon = input.session("0700-1200", "London Session",  group="Sessions")
sessionNY  = input.session("1330-2000", "NY Session",      group="Sessions")
longCol    = input.color(color.new(#26a69a, 0), "Long Color",  group="Visuals")
shortCol   = input.color(color.new(#ef5350, 0), "Short Color", group="Visuals")
boxWidth   = input.int(30, "Box Width after entry (bars)", minval=5, maxval=100, group="Visuals")
showMonthlyStats = input.bool(true, "Show Monthly Stats Table", group="Visuals")

var string[] monthKeys = array.new_string()
var int[]    monthWins = array.new_int()
var int[]    monthLosses = array.new_int()
var float[]  monthR = array.new_float()

var int firstBarTime = time

var float currentDrawdown = 0.0
var float maxDrawdown = 0.0
var float peakR = 0.0
var float cumulativeR = 0.0

var float currentConsWinR = 0.0
var float maxConsWinR = 0.0
var float currentConsLossR = 0.0
var float maxConsLossR = 0.0

// ─── Session ──────────────────────────────────────────────────────────────────
inLondon  = not na(time(timeframe.period, sessionLon, "Europe/Berlin"))
inNY      = not na(time(timeframe.period, sessionNY,  "America/New_York"))
inSession = inLondon or inNY

atr = ta.atr(14)

// ─── Pivots → Liquidity ───────────────────────────────────────────────────────
swingH = ta.pivothigh(high, swingLen, swingLen)
swingL = ta.pivotlow(low,  swingLen, swingLen)

var float[] bslLvls  = array.new_float()
var bool[]  bslSwept = array.new_bool()
var float[] sslLvls  = array.new_float()
var bool[]  sslSwept = array.new_bool()

f_trimLiq(float[] lvls, bool[] sw, int maxN) =>
    while array.size(lvls) > maxN
        array.shift(lvls)
        array.shift(sw)

if not na(swingH)
    array.push(bslLvls, swingH)
    array.push(bslSwept, false)
    f_trimLiq(bslLvls, bslSwept, maxLevels)

if not na(swingL)
    array.push(sslLvls, swingL)
    array.push(sslSwept, false)
    f_trimLiq(sslLvls, sslSwept, maxLevels)

// ─── FVG ──────────────────────────────────────────────────────────────────────
bullFVG = low > high[2]
bearFVG = high < low[2]

var float[] bFvgTop = array.new_float()
var float[] bFvgBot = array.new_float()
var int[]   bFvgBar = array.new_int()
var float[] sFvgTop = array.new_float()
var float[] sFvgBot = array.new_float()
var int[]   sFvgBar = array.new_int()

if bullFVG
    array.push(bFvgTop, low)
    array.push(bFvgBot, high[2])
    array.push(bFvgBar, bar_index)
if bearFVG
    array.push(sFvgTop, low[2])
    array.push(sFvgBot, high)
    array.push(sFvgBar, bar_index)

maxFvg = 20
while array.size(bFvgTop) > maxFvg
    array.shift(bFvgTop)
    array.shift(bFvgBot)
    array.shift(bFvgBar)
while array.size(sFvgTop) > maxFvg
    array.shift(sFvgTop)
    array.shift(sFvgBot)
    array.shift(sFvgBar)

// ─── Sweeps ───────────────────────────────────────────────────────────────────
sslSweep  = false
bslSweep  = false
sweepLow  = 0.0
sweepHigh = 0.0

nb = array.size(sslLvls)
if nb > 0
    for i = 0 to nb - 1
        if not array.get(sslSwept, i)
            lvl = array.get(sslLvls, i)
            if low < lvl and close > lvl
                array.set(sslSwept, i, true)
                sslSweep := true
                sweepLow := low

nc = array.size(bslLvls)
if nc > 0
    for i = 0 to nc - 1
        if not array.get(bslSwept, i)
            lvl = array.get(bslLvls, i)
            if high > lvl and close < lvl
                array.set(bslSwept, i, true)
                bslSweep := true
                sweepHigh := high

// ─── Signal tracking ──────────────────────────────────────────────────────────
var int[]   sigDir    = array.new_int()
var float[] sigEntry  = array.new_float()
var float[] sigSL     = array.new_float()
var float[] sigTP     = array.new_float()
var int[]   sigResult = array.new_int()
var int[]   sigBar    = array.new_int()
var box[]   sigTpBox  = array.new_box()
var box[]   sigSlBox  = array.new_box()
var line[]  sigEntryL = array.new_line()

nSig = array.size(sigDir)
if nSig > 0
    for i = 0 to nSig - 1
        if array.get(sigResult, i) == 0
            d        = array.get(sigDir, i)
            tp       = array.get(sigTP,  i)
            sl       = array.get(sigSL,  i)
            age      = bar_index - array.get(sigBar, i)
            resolved = false
            if age >= expireBars * 3
                array.set(sigResult, i, 2)
                resolved := true
            else if d == 1
                if high >= tp
                    array.set(sigResult, i, 1)
                    resolved := true
                else if low <= sl
                    array.set(sigResult, i, -1)
                    resolved := true
            else
                if low <= tp
                    array.set(sigResult, i, 1)
                    resolved := true
                else if high >= sl
                    array.set(sigResult, i, -1)
                    resolved := true
            if resolved
                int finalRes = array.get(sigResult, i)
                if finalRes == 1 or finalRes == -1
                    string mStr = str.tostring(year(time)) + "-" + (month(time) < 10 ? "0" : "") + str.tostring(month(time))
                    int idx = array.indexof(monthKeys, mStr)
                    if idx == -1
                        array.push(monthKeys, mStr)
                        array.push(monthWins, 0)
                        array.push(monthLosses, 0)
                        array.push(monthR, 0.0)
                        idx := array.size(monthKeys) - 1
                    
                    if finalRes == 1
                        array.set(monthWins, idx, array.get(monthWins, idx) + 1)
                        array.set(monthR, idx, array.get(monthR, idx) + rrRatio)
                        
                        currentConsLossR := 0.0
                        currentConsWinR += rrRatio
                        if currentConsWinR > maxConsWinR
                            maxConsWinR := currentConsWinR
                            
                        cumulativeR += rrRatio
                        if cumulativeR > peakR
                            peakR := cumulativeR
                            
                    else if finalRes == -1
                        array.set(monthLosses, idx, array.get(monthLosses, idx) + 1)
                        array.set(monthR, idx, array.get(monthR, idx) - 1.0)
                        
                        currentConsWinR := 0.0
                        currentConsLossR += 1.0
                        if currentConsLossR > maxConsLossR
                            maxConsLossR := currentConsLossR
                            
                        cumulativeR -= 1.0
                        float currentDD = peakR - cumulativeR
                        if currentDD > maxDrawdown
                            maxDrawdown := currentDD

                box.set_right(array.get(sigTpBox,  i), bar_index)
                box.set_right(array.get(sigSlBox,  i), bar_index)
                line.set_x2(array.get(sigEntryL,   i), bar_index)

hasOpen = false
nSig2 = array.size(sigResult)
if nSig2 > 0
    for i = 0 to nSig2 - 1
        if array.get(sigResult, i) == 0
            hasOpen := true

while array.size(sigDir) > statsLen
    array.shift(sigDir)
    array.shift(sigEntry)
    array.shift(sigSL)
    array.shift(sigTP)
    array.shift(sigResult)
    array.shift(sigBar)
    array.shift(sigTpBox)
    array.shift(sigSlBox)
    array.shift(sigEntryL)

// ─── Setup state ─────────────────────────────────────────────────────────────
var bool  lookLong  = false
var bool  lookShort = false
var int   setupBarL = 0
var int   setupBarS = 0
var float setupSLL  = 0.0
var float setupSLS  = 0.0
var int   lastBias  = 0

if sslSweep and inSession and not hasOpen
    lookLong  := true
    lookShort := false
    setupBarL := bar_index
    setupSLL  := sweepLow - atr * atrMult
    lastBias  := 1
    if showDebug
        label.new(bar_index, low, "SSL▲", style=label.style_label_up,
                  color=color.new(longCol, 50), textcolor=color.white, size=size.tiny)

if bslSweep and inSession and not hasOpen
    lookShort := true
    lookLong  := false
    setupBarS := bar_index
    setupSLS  := sweepHigh + atr * atrMult
    lastBias  := -1
    if showDebug
        label.new(bar_index, high, "BSL▼", style=label.style_label_down,
                  color=color.new(shortCol, 50), textcolor=color.white, size=size.tiny)

if not inSession
    lookLong  := false
    lookShort := false

if lookLong  and (bar_index - setupBarL) > expireBars
    lookLong  := false
if lookShort and (bar_index - setupBarS) > expireBars
    lookShort := false

// ─── Entry ────────────────────────────────────────────────────────────────────
newLong  = false
newShort = false

if lookLong and not hasOpen
    nf = array.size(bFvgBar)
    if nf > 0
        for i = nf - 1 to 0
            if array.get(bFvgBar, i) > setupBarL
                fTop = array.get(bFvgTop, i)
                fBot = array.get(bFvgBot, i)
                mid  = (fTop + fBot) / 2
                if low <= fTop and close > fBot
                    entryP = mid
                    slP    = setupSLL
                    slDist = entryP - slP
                    if slDist > 0
                        tpP = entryP + slDist * rrRatio
                        x1  = bar_index
                        x2  = bar_index + boxWidth
                        bTP = box.new(x1, tpP, x2, entryP,
                                      border_color=color.new(#26a69a, 30), bgcolor=color.new(#26a69a, 75),
                                      text="TP " + str.tostring(tpP, "#.#####"),
                                      text_color=color.new(color.white, 20),
                                      text_size=size.small, text_halign=text.align_right, text_valign=text.align_top)
                        bSL = box.new(x1, entryP, x2, slP,
                                      border_color=color.new(#ef5350, 30), bgcolor=color.new(#ef5350, 75),
                                      text="SL " + str.tostring(slP, "#.#####"),
                                      text_color=color.new(color.white, 20),
                                      text_size=size.small, text_halign=text.align_right, text_valign=text.align_bottom)
                        ln = line.new(x1, entryP, x2, entryP, color=color.white, width=2, style=line.style_dashed)
                        label.new(x1, entryP, "▶ LONG  " + str.tostring(entryP, "#.#####"),
                                  style=label.style_label_right, color=color.white, textcolor=color.black, size=size.small)
                        array.push(sigDir, 1)
                        array.push(sigEntry, entryP)
                        array.push(sigSL, slP)
                        array.push(sigTP, tpP)
                        array.push(sigResult, 0)
                        array.push(sigBar, bar_index)
                        array.push(sigTpBox, bTP)
                        array.push(sigSlBox, bSL)
                        array.push(sigEntryL, ln)
                        
                        string longJson = '{\n  "action": "buy",\n  "symbol": "' + syminfo.ticker + '",\n  "entry_price": ' + str.tostring(entryP) + ',\n  "sl": ' + str.tostring(slP) + ',\n  "tp": ' + str.tostring(tpP) + ',\n  "cmp": ' + str.tostring(close) + '\n}'
                        alert(longJson, alert.freq_once_per_bar)
                        
                        lookLong := false
                        newLong  := true
                        break

if lookShort and not hasOpen
    nf = array.size(sFvgBar)
    if nf > 0
        for i = nf - 1 to 0
            if array.get(sFvgBar, i) > setupBarS
                fTop = array.get(sFvgTop, i)
                fBot = array.get(sFvgBot, i)
                mid  = (fTop + fBot) / 2
                if high >= fBot and close < fTop
                    entryP = mid
                    slP    = setupSLS
                    slDist = slP - entryP
                    if slDist > 0
                        tpP = entryP - slDist * rrRatio
                        x1  = bar_index
                        x2  = bar_index + boxWidth
                        bTP = box.new(x1, entryP, x2, tpP,
                                      border_color=color.new(#26a69a, 30), bgcolor=color.new(#26a69a, 75),
                                      text="TP " + str.tostring(tpP, "#.#####"),
                                      text_color=color.new(color.white, 20),
                                      text_size=size.small, text_halign=text.align_right, text_valign=text.align_bottom)
                        bSL = box.new(x1, slP, x2, entryP,
                                      border_color=color.new(#ef5350, 30), bgcolor=color.new(#ef5350, 75),
                                      text="SL " + str.tostring(slP, "#.#####"),
                                      text_color=color.new(color.white, 20),
                                      text_size=size.small, text_halign=text.align_right, text_valign=text.align_bottom)
                        ln = line.new(x1, entryP, x2, entryP, color=color.white, width=2, style=line.style_dashed)
                        label.new(x1, entryP, "▶ SHORT  " + str.tostring(entryP, "#.#####"),
                                  style=label.style_label_right, color=color.white, textcolor=color.black, size=size.small)
                        array.push(sigDir, -1)
                        array.push(sigEntry, entryP)
                        array.push(sigSL, slP)
                        array.push(sigTP, tpP)
                        array.push(sigResult, 0)
                        array.push(sigBar, bar_index)
                        array.push(sigTpBox, bTP)
                        array.push(sigSlBox, bSL)
                        array.push(sigEntryL, ln)
                        
                        string shortJson = '{\n  "action": "sell",\n  "symbol": "' + syminfo.ticker + '",\n  "entry_price": ' + str.tostring(entryP) + ',\n  "sl": ' + str.tostring(slP) + ',\n  "tp": ' + str.tostring(tpP) + ',\n  "cmp": ' + str.tostring(close) + '\n}'
                        alert(shortJson, alert.freq_once_per_bar)
                        
                        lookShort := false
                        newShort  := true
                        break

// ─── Stats table ─────────────────────────────────────────────────────────────
var table tbl = table.new(position.top_right, 2, 8,
                           bgcolor=color.new(color.black, 75), border_width=1,
                           border_color=color.new(color.gray, 60))

var table mTbl = table.new(position.bottom_right, 4, 100,
                           bgcolor=color.new(color.black, 75), border_width=1,
                           border_color=color.new(color.gray, 60))

if barstate.islast
    wins   = 0
    losses = 0
    openS  = 0
    exp    = 0
    n = array.size(sigResult)
    if n > 0
        for i = 0 to n - 1
            r = array.get(sigResult, i)
            if r == 1
                wins += 1
            else if r == -1
                losses += 1
            else if r == 2
                exp += 1
            else
                openS += 1
    total = wins + losses
    wr    = total > 0 ? wins / total * 100 : 0.0
    wrCol = wr >= 50 ? color.new(#26a69a, 0) : color.new(#ef5350, 0)

    biasStr = lastBias == 1 ? "Bullish ▲" : lastBias == -1 ? "Bearish ▼" : "–"
    biasCol = lastBias == 1 ? color.new(#26a69a, 0) : lastBias == -1 ? color.new(#ef5350, 0) : color.new(color.gray, 0)

    table.cell(tbl, 0, 0, "EV LSS",   text_color=color.gray, text_size=size.small, bgcolor=color.new(color.black, 50))
    table.cell(tbl, 1, 0, "Signals",  text_color=color.gray, text_size=size.small, bgcolor=color.new(color.black, 50))
    table.cell(tbl, 0, 1, "Bias",     text_color=color.gray, text_size=size.small)
    table.cell(tbl, 1, 1, biasStr,    text_color=biasCol,    text_size=size.normal)
    table.cell(tbl, 0, 2, "Win Rate", text_color=color.gray, text_size=size.small)
    table.cell(tbl, 1, 2, str.tostring(wr, "#.0") + "%", text_color=wrCol, text_size=size.normal)
    table.cell(tbl, 0, 3, "Wins",     text_color=color.gray, text_size=size.small)
    table.cell(tbl, 1, 3, str.tostring(wins),   text_color=color.new(#26a69a, 0), text_size=size.small)
    table.cell(tbl, 0, 4, "Losses",   text_color=color.gray, text_size=size.small)
    table.cell(tbl, 1, 4, str.tostring(losses), text_color=color.new(#ef5350, 0), text_size=size.small)
    table.cell(tbl, 0, 5, "Expired",  text_color=color.gray, text_size=size.small)
    table.cell(tbl, 1, 5, str.tostring(exp),    text_color=color.gray,            text_size=size.small)
    table.cell(tbl, 0, 6, "Open",     text_color=color.gray, text_size=size.small)
    table.cell(tbl, 1, 6, str.tostring(openS),  text_color=color.white,           text_size=size.small)
    table.cell(tbl, 0, 7, "Sample",   text_color=color.gray, text_size=size.small)
    table.cell(tbl, 1, 7, str.tostring(total) + "/" + str.tostring(statsLen), text_color=color.gray, text_size=size.small)

    if showMonthlyStats
        table.cell(mTbl, 0, 0, "Month",   text_color=color.gray, text_size=size.small, bgcolor=color.new(color.black, 50))
        table.cell(mTbl, 1, 0, "Returns (R)", text_color=color.gray, text_size=size.small, bgcolor=color.new(color.black, 50))
        table.cell(mTbl, 2, 0, "Winrate", text_color=color.gray, text_size=size.small, bgcolor=color.new(color.black, 50))
        table.cell(mTbl, 3, 0, "Trades",  text_color=color.gray, text_size=size.small, bgcolor=color.new(color.black, 50))
        
        int mSize = array.size(monthKeys)
        int lastRow = 0
        if mSize > 0
            int maxShow = math.min(mSize, 95)
            for i = 0 to maxShow - 1
                int mIdx = mSize - 1 - i // Show latest first
                string mStr = array.get(monthKeys, mIdx)
                int mWins = array.get(monthWins, mIdx)
                int mLosses = array.get(monthLosses, mIdx)
                float mR = array.get(monthR, mIdx)
                int mTrades = mWins + mLosses
                float mWr = mTrades > 0 ? (mWins * 100.0) / mTrades : 0.0
                
                color rCol = mR > 0 ? color.new(#26a69a, 0) : mR < 0 ? color.new(#ef5350, 0) : color.gray
                color wrCol = mWr >= 50 ? color.new(#26a69a, 0) : color.new(#ef5350, 0)
                
                table.cell(mTbl, 0, i + 1, mStr, text_color=color.white, text_size=size.small)
                table.cell(mTbl, 1, i + 1, str.tostring(mR, "#.##") + "R", text_color=rCol, text_size=size.small)
                table.cell(mTbl, 2, i + 1, str.tostring(mWr, "#.0") + "%", text_color=wrCol, text_size=size.small)
                table.cell(mTbl, 3, i + 1, str.tostring(mTrades), text_color=color.white, text_size=size.small)
                lastRow := i + 1
                
        table.cell(mTbl, 0, lastRow + 1, "Max Drawdown", text_color=color.gray, text_size=size.small, bgcolor=color.new(color.black, 50))
        table.cell(mTbl, 1, lastRow + 1, "-" + str.tostring(maxDrawdown, "#.##") + "R", text_color=color.new(#ef5350, 0), text_size=size.small, bgcolor=color.new(color.black, 50))
        table.cell(mTbl, 2, lastRow + 1, "", bgcolor=color.new(color.black, 50))
        table.cell(mTbl, 3, lastRow + 1, "", bgcolor=color.new(color.black, 50))
        
        table.cell(mTbl, 0, lastRow + 2, "Cons Win", text_color=color.gray, text_size=size.small, bgcolor=color.new(color.black, 50))
        table.cell(mTbl, 1, lastRow + 2, "+" + str.tostring(maxConsWinR, "#.##") + "R", text_color=color.new(#26a69a, 0), text_size=size.small, bgcolor=color.new(color.black, 50))
        table.cell(mTbl, 2, lastRow + 2, "", bgcolor=color.new(color.black, 50))
        table.cell(mTbl, 3, lastRow + 2, "", bgcolor=color.new(color.black, 50))
        
        table.cell(mTbl, 0, lastRow + 3, "Cons Loss", text_color=color.gray, text_size=size.small, bgcolor=color.new(color.black, 50))
        table.cell(mTbl, 1, lastRow + 3, "-" + str.tostring(maxConsLossR, "#.##") + "R", text_color=color.new(#ef5350, 0), text_size=size.small, bgcolor=color.new(color.black, 50))
        table.cell(mTbl, 2, lastRow + 3, "", bgcolor=color.new(color.black, 50))
        table.cell(mTbl, 3, lastRow + 3, "", bgcolor=color.new(color.black, 50))
        
        table.cell(mTbl, 0, lastRow + 4, "Data From", text_color=color.gray, text_size=size.small, bgcolor=color.new(color.black, 50))
        table.cell(mTbl, 1, lastRow + 4, str.format("{0,date,yyyy-MM-dd HH:mm}", firstBarTime), text_color=color.white, text_size=size.small, bgcolor=color.new(color.black, 50))
        table.cell(mTbl, 2, lastRow + 4, "", bgcolor=color.new(color.black, 50))
        table.cell(mTbl, 3, lastRow + 4, "", bgcolor=color.new(color.black, 50))

// ─── Alerts ───────────────────────────────────────────────────────────────────
alertcondition(newLong,             "LSS Long",  "EV LSS — LONG {{ticker}} {{interval}}")
alertcondition(newShort,            "LSS Short", "EV LSS — SHORT {{ticker}} {{interval}}")
alertcondition(newLong or newShort, "LSS Any",   "EV LSS — Signal {{ticker}} {{interval}}")

`;

const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1D'];

interface Dataset {
  id: number;
  dataset_id: string;
  symbol: string;
  timeframe: string;
  source_name: string;
  start_timestamp: number;
  end_timestamp: number;
  candle_count: number;
  data_hash: string;
  quality_status: string;
}

export default function Home() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [isBacktesting, setIsBacktesting] = useState(false);
  const [chartData, setChartData] = useState<any[]>([]);
  const [trades, setTrades] = useState<any[]>([]);
  const [tradeBoxes, setTradeBoxes] = useState<any[]>([]);
  const [indicatorSeries, setIndicatorSeries] = useState<Record<string, (number | null)[]>>({});
  const [metrics, setMetrics] = useState<BacktestMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [datasetInfo, setDatasetInfo] = useState<DatasetInfo | null>(null);
  const [drawings, setDrawings] = useState<any>(null);

  // Dataset state
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>('');
  const [viewTimeframe, setViewTimeframe] = useState<string>('5m');

  // Panel visibility
  const [showEditor, setShowEditor] = useState(false);
  const [showTester, setShowTester] = useState(true);
  const [activeBottomTab, setActiveBottomTab] = useState<'tester' | 'editor'>('tester');

  // OHLC display
  const [lastBar, setLastBar] = useState<any>(null);

  // Load datasets on mount
  useEffect(() => {
    fetch('/api/datasets')
      .then(r => r.json())
      .then(d => {
        const dsets: Dataset[] = d.datasets || [];
        setDatasets(dsets);
        if (dsets.length > 0) {
          setSelectedDatasetId(String(dsets[0].id));
          setViewTimeframe(dsets[0].timeframe);
        }
      })
      .catch(() => {});
  }, []);

  const selectedDataset = datasets.find(d => String(d.id) === selectedDatasetId);

  // Derivable timeframes
  const derivableTimeframes = selectedDataset
    ? TIMEFRAMES.filter(tf => {
        const TF_MS: Record<string, number> = { '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '4h': 14400000, '1D': 86400000, '1d': 86400000 };
        const sourceMs = TF_MS[selectedDataset.timeframe] || 60000;
        const targetMs = TF_MS[tf] || 60000;
        return targetMs >= sourceMs && targetMs % sourceMs === 0;
      })
    : [];

  const runBacktest = useCallback(async () => {
    if (!selectedDatasetId) {
      setError('Select a dataset first.');
      return;
    }
    setIsBacktesting(true);
    setError(null);
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceCode: code,
          datasetId: selectedDatasetId,
          viewTimeframe: viewTimeframe || selectedDataset?.timeframe,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === 'object' ? JSON.stringify(data.error) : data.error || 'Backtest failed');

      setChartData(data.bars);
      setMetrics(data.metrics);
      setIndicatorSeries(data.metrics.indicatorSeries || {});
      setDatasetInfo({
        symbol: data.metrics.symbol,
        view_timeframe: data.metrics.view_timeframe,
        source_timeframe: data.metrics.source_timeframe,
        source_name: data.metrics.source_name,
        data_period_start: data.metrics.data_period_start,
        data_period_end: data.metrics.data_period_end,
        candle_count: data.metrics.candle_count,
        data_hash: data.metrics.data_hash,
      });
      setDrawings(data.metrics.drawings);

      // Last bar for OHLC display
      if (data.bars?.length > 0) {
        setLastBar(data.bars[data.bars.length - 1]);
      }

      // Trade markers
      const mappedTrades: any[] = [];
      const mappedBoxes: any[] = [];
      data.metrics.trades.forEach((t: any) => {
        mappedTrades.push({ time: t.entryTime, type: t.direction === 'long' ? 'buy' : 'sell', price: t.entryPrice });
        mappedTrades.push({ time: t.exitTime, type: t.direction === 'long' ? 'sell' : 'buy', price: t.exitPrice });
        mappedBoxes.push({ entryTime: t.entryTime, exitTime: t.exitTime, entryPrice: t.entryPrice, exitPrice: t.exitPrice, direction: t.direction, pnl: t.pnl });
      });
      setTrades(mappedTrades);
      setTradeBoxes(mappedBoxes);
      setShowTester(true);
      setActiveBottomTab('tester');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsBacktesting(false);
    }
  }, [code, selectedDatasetId, viewTimeframe, selectedDataset]);

  const changeBar = lastBar || {};
  const isUp = changeBar.close >= changeBar.open;

  return (
    <div className={styles.container}>
      {/* ═══ TOP TOOLBAR ═══ */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarGroup}>
          {/* Symbol selector */}
          <select
            className={styles.symbolBtn}
            value={selectedDatasetId}
            onChange={e => {
              setSelectedDatasetId(e.target.value);
              const ds = datasets.find(d => String(d.id) === e.target.value);
              if (ds) setViewTimeframe(ds.timeframe);
            }}
          >
            <option value="">— Select —</option>
            {datasets.map(d => (
              <option key={d.id} value={String(d.id)}>
                {d.symbol}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.toolbarDivider} />

        {/* Timeframe buttons */}
        <div className={styles.toolbarGroup}>
          {derivableTimeframes.map(tf => (
            <button
              key={tf}
              className={viewTimeframe === tf ? styles.tfBtnActive : styles.tfBtn}
              onClick={() => setViewTimeframe(tf)}
            >
              {tf.toUpperCase()}
            </button>
          ))}
        </div>

        <div className={styles.toolbarDivider} />

        {/* Tool buttons */}
        <button className={styles.toolBtn} title="Indicators">
          <span>📊</span> Indicators
        </button>
        <button
          className={activeBottomTab === 'editor' && showEditor ? styles.toolBtnActive : styles.toolBtn}
          onClick={() => { setShowEditor(!showEditor); setActiveBottomTab('editor'); }}
        >
          <span>📝</span> Pine Editor
        </button>
        <button
          className={showTester ? styles.toolBtnActive : styles.toolBtn}
          onClick={() => setShowTester(!showTester)}
        >
          <span>📈</span> Strategy Tester
        </button>

        <div className={styles.spacer} />

        {/* Run Backtest */}
        <button
          className={styles.runBtn}
          onClick={runBacktest}
          disabled={isBacktesting || !selectedDatasetId}
        >
          {isBacktesting ? '⏳ Running…' : '▶ Run Backtest'}
        </button>
      </div>

      {/* ═══ OHLC BAR ═══ */}
      <div className={styles.ohlcBar}>
        <span className={styles.ohlcSymbol}>
          {selectedDataset ? `${selectedDataset.symbol} · ${viewTimeframe.toUpperCase()}` : 'No Data'}
        </span>
        {lastBar && (
          <>
            <span className={styles.ohlcLabel}>O</span>
            <span className={isUp ? styles.ohlcUp : styles.ohlcDown}>{Number(lastBar.open).toFixed(2)}</span>
            <span className={styles.ohlcLabel}>H</span>
            <span className={isUp ? styles.ohlcUp : styles.ohlcDown}>{Number(lastBar.high).toFixed(2)}</span>
            <span className={styles.ohlcLabel}>L</span>
            <span className={isUp ? styles.ohlcUp : styles.ohlcDown}>{Number(lastBar.low).toFixed(2)}</span>
            <span className={styles.ohlcLabel}>C</span>
            <span className={isUp ? styles.ohlcUp : styles.ohlcDown}>{Number(lastBar.close).toFixed(2)}</span>
            <span className={isUp ? styles.ohlcUp : styles.ohlcDown}>
              {isUp ? '+' : ''}{(lastBar.close - lastBar.open).toFixed(2)} ({((lastBar.close - lastBar.open) / lastBar.open * 100).toFixed(2)}%)
            </span>
          </>
        )}
        {selectedDataset && (
          <span style={{ marginLeft: 'auto', color: '#787b86', fontSize: '0.65rem' }}>
            {selectedDataset.source_name} · {new Date(selectedDataset.start_timestamp).toISOString().slice(0, 10)} → {new Date(selectedDataset.end_timestamp).toISOString().slice(0, 10)} · {selectedDataset.candle_count.toLocaleString()} candles
          </span>
        )}
      </div>

      {/* Error banner */}
      {error && <div className={styles.errorBanner}>⚠ {error}</div>}

      {/* ═══ MAIN AREA ═══ */}
      <div className={styles.mainArea}>
        {/* Left sidebar - drawing tools */}
        <div className={styles.leftSidebar}>
          <button className={styles.sideBtnActive} title="Crosshair">+</button>
          <button className={styles.sideBtn} title="Trend Line">╲</button>
          <button className={styles.sideBtn} title="Horizontal Line">—</button>
          <button className={styles.sideBtn} title="Rectangle">▭</button>
          <button className={styles.sideBtn} title="Fibonacci">𝐹</button>
          <button className={styles.sideBtn} title="Text">T</button>
          <button className={styles.sideBtn} title="Measure">📏</button>
          <div style={{ flex: 1 }} />
          <button className={styles.sideBtn} title="Magnet">🧲</button>
        </div>

        {/* Chart + bottom panels */}
        <div className={styles.chartArea}>
          {/* Chart */}
          <div className={styles.chartWrapper}>
            {chartData.length > 0 ? (
              <>
                <Chart
                  data={chartData}
                  trades={trades}
                  tradeBoxes={tradeBoxes}
                  indicatorSeries={indicatorSeries}
                  datasetInfo={datasetInfo || undefined}
                  drawings={drawings}
                />
                {/* Stats overlay (like TV's indicator stats box) */}
                {metrics && metrics.num_trades > 0 && (
                  <div className={styles.statsOverlay}>
                    <div className={styles.statsRow}>
                      <span className={styles.statsLabel}>Net Profit</span>
                      <span className={metrics.net_profit >= 0 ? styles.statsUp : styles.statsDown}>
                        ${metrics.net_profit.toFixed(2)}
                      </span>
                    </div>
                    <div className={styles.statsRow}>
                      <span className={styles.statsLabel}>Win Rate</span>
                      <span className={(metrics.win_rate * 100) >= 50 ? styles.statsUp : styles.statsDown}>
                        {(metrics.win_rate * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className={styles.statsRow}>
                      <span className={styles.statsLabel}>Trades</span>
                      <span className={styles.statsValue}>{metrics.num_trades}</span>
                    </div>
                    <div className={styles.statsRow}>
                      <span className={styles.statsLabel}>Profit Factor</span>
                      <span className={styles.statsValue}>
                        {metrics.profit_factor === Infinity ? '∞' : metrics.profit_factor.toFixed(2)}
                      </span>
                    </div>
                    <div className={styles.statsRow}>
                      <span className={styles.statsLabel}>Max DD</span>
                      <span className={styles.statsDown}>{(metrics.max_drawdown * 100).toFixed(2)}%</span>
                    </div>
                    <div className={styles.statsRow}>
                      <span className={styles.statsLabel}>Sharpe</span>
                      <span className={styles.statsValue}>{metrics.sharpe_ratio.toFixed(2)}</span>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#787b86', fontSize: '0.85rem' }}>
                {selectedDatasetId
                  ? 'Press ▶ Run Backtest to load historical data'
                  : 'Select a dataset from the toolbar to begin'}
              </div>
            )}
          </div>

          {/* Bottom time bar */}
          <div className={styles.timeBar}>
            {['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'All'].map(range => (
              <button key={range} className={styles.timeTfBtn}>{range}</button>
            ))}
            <span className={styles.timeInfo}>
              {new Date().toLocaleTimeString('en-US', { hour12: false })} UTC{new Date().getTimezoneOffset() > 0 ? '-' : '+'}{Math.abs(new Date().getTimezoneOffset() / 60)}
            </span>
          </div>

          {/* ═══ BOTTOM PANELS ═══ */}
          {(showTester || showEditor) && (
            <div className={styles.bottomPanels} style={{ height: activeBottomTab === 'editor' ? 250 : 220 }}>
              <div className={styles.bottomTabs}>
                <button
                  className={activeBottomTab === 'tester' ? styles.bottomTabActive : styles.bottomTab}
                  onClick={() => { setActiveBottomTab('tester'); setShowTester(true); }}
                >
                  📈 Strategy Tester {metrics ? `(${metrics.num_trades})` : ''}
                </button>
                <button
                  className={activeBottomTab === 'editor' ? styles.bottomTabActive : styles.bottomTab}
                  onClick={() => { setActiveBottomTab('editor'); setShowEditor(true); }}
                >
                  📝 Pine Editor
                </button>
                <button
                  className={styles.bottomClose}
                  onClick={() => { setShowTester(false); setShowEditor(false); }}
                  title="Close panel"
                >
                  ✕
                </button>
              </div>
              <div className={styles.bottomContent}>
                {activeBottomTab === 'tester' && (
                  <StrategyTester metrics={metrics} isLoading={isBacktesting} />
                )}
                {activeBottomTab === 'editor' && (
                  <div style={{ height: '100%' }}>
                    <PineEditor value={code} onChange={(v) => setCode(v || '')} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
