// @ts-nocheck
'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import styles from './page.module.css';
import { Backtester } from '@/lib/backtester/engine';
import { StrategyTester, BacktestMetrics } from '@/components/StrategyTester';
import type { DatasetInfo } from '@/components/Chart';
import { calculateSMA, calculateEMA, calculateBollingerBands } from '@/lib/indicators';
import { 
  IconIndicators, IconCode, IconStrategy, IconReplay, IconPlay, IconPause, 
  IconForward, IconClose, IconCalendar, IconCrosshair, IconTrendLine, 
  IconFib, IconBrush, IconText, IconMagnet, IconTrash 
} from '@/components/Icons';

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
                        label.new(x1, entryP, "▶ LONG  " + str.tostring(entryP, "#.##"),
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
                        label.new(x1, entryP, "▶ SHORT  " + str.tostring(entryP, "#.##"),
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
  const [tradeBoxes, setTradeBoxes] = useState<any[]>([]);
  const [indicatorSeries, setIndicatorSeries] = useState<Record<string, (number | null)[]>>({});
  const [metrics, setMetrics] = useState<BacktestMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [datasetInfo, setDatasetInfo] = useState<DatasetInfo | null>(null);
  const [drawings, setDrawings] = useState<any>(null);
  const skipRawReloadRef = useRef(false);

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

  const [isResizing, setIsResizing] = useState(false);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(350);
  const [timeRangeTrigger, setTimeRangeTrigger] = useState<string>('');
  
  // Go To modal state
  const [showGoToModal, setShowGoToModal] = useState(false);
  const [goToDateStr, setGoToDateStr] = useState('');
  const [goToTimeStr, setGoToTimeStr] = useState('00:00');
  const [goToTimestamp, setGoToTimestamp] = useState<number | null>(null);

  // Replay State
  const [isReplayActive, setIsReplayActive] = useState(false);
  const [replayIndex, setReplayIndex] = useState<number | null>(null); // current bar index
  const [isReplaying, setIsReplaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(1000); // ms per bar
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);

  // Drawing State
  const [activeDrawingTool, setActiveDrawingTool] = useState<string | null>(null);
  const [userDrawings, setUserDrawings] = useState<{ id?: string, type: string, points: any[] }[]>([]);
  const [drawingsLoaded, setDrawingsLoaded] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('userDrawings');
    if (stored) {
      try {
        setUserDrawings(JSON.parse(stored));
      } catch (e) {}
    }
    setDrawingsLoaded(true);
  }, []);

  useEffect(() => {
    if (drawingsLoaded) {
      localStorage.setItem('userDrawings', JSON.stringify(userDrawings));
    }
  }, [userDrawings, drawingsLoaded]);

  // Native Indicators State
  const [showIndicatorModal, setShowIndicatorModal] = useState(false);
  const [activeNativeIndicators, setActiveNativeIndicators] = useState<string[]>([]);
  const [hiddenIndicators, setHiddenIndicators] = useState<string[]>([]);
  const [showMarketPanel, setShowMarketPanel] = useState(true);

  useEffect(() => {
    if (!showIndicatorModal && !showGoToModal) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setShowIndicatorModal(false);
      setShowGoToModal(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showIndicatorModal, showGoToModal]);

  // --- Replay Playback ---
  useEffect(() => {
    let interval: any;
    if (isReplayActive && isReplaying && replayIndex !== null && chartData.length > 0) {
      interval = setInterval(() => {
        setReplayIndex(prev => {
          if (prev === null || prev >= chartData.length - 1) {
            setIsReplaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, replaySpeed);
    }
    return () => clearInterval(interval);
  }, [isReplayActive, isReplaying, replayIndex, chartData, replaySpeed]);

  // Derived sliced data for Replay mode
  const visibleChartData = isReplayActive && replayIndex !== null ? chartData.slice(0, replayIndex + 1) : chartData;
  const visibleLastTime = visibleChartData.length > 0 ? visibleChartData[visibleChartData.length - 1].time : null;
  const visibleLastTimestamp = visibleLastTime ? (typeof visibleLastTime === 'string' ? new Date(visibleLastTime).getTime() : visibleLastTime * (visibleLastTime > 1e10 ? 1 : 1000)) : null;

  // --- Native Indicators Computation ---
  const nativeSeries: Record<string, any[]> = {};
  if (chartData.length > 0) {
    if (activeNativeIndicators.includes('sma20')) {
      nativeSeries['SMA 20'] = calculateSMA(chartData, 20);
    }
    if (activeNativeIndicators.includes('ema20')) {
      nativeSeries['EMA 20'] = calculateEMA(chartData, 20);
    }
    if (activeNativeIndicators.includes('bb')) {
      const bb = calculateBollingerBands(chartData, 20, 2);
      nativeSeries['BB Upper'] = bb.upper;
      nativeSeries['BB Lower'] = bb.lower;
      nativeSeries['BB Basis'] = bb.basis;
    }
  }

  // Merge backtest indicators and native indicators
  const mergedIndicatorSeries = Object.fromEntries(
    Object.entries({ ...indicatorSeries, ...nativeSeries })
      .filter(([key]) => !hiddenIndicators.includes(key))
  );
  
  // Slice indicators for replay mode
  const visibleIndicatorSeries: Record<string, any[]> = {};
  for (const [key, arr] of Object.entries(mergedIndicatorSeries)) {
    if (isReplayActive && replayIndex !== null) {
      visibleIndicatorSeries[key] = arr.slice(0, replayIndex + 1);
    } else {
      visibleIndicatorSeries[key] = arr;
    }
  }

  const visibleBoxes = isReplayActive && visibleLastTimestamp
    ? tradeBoxes.filter(b => new Date(b.entryTime).getTime() <= visibleLastTimestamp) // only show if entry has happened
    : tradeBoxes;

  const visibleDrawings = isReplayActive && visibleLastTimestamp && drawings ? {
    boxes: drawings.boxes?.filter((b: any) => {
      const idx = Math.floor(b.left);
      return idx < chartData.length && (typeof chartData[idx].time === 'string' ? new Date(chartData[idx].time).getTime() : chartData[idx].time * (chartData[idx].time > 1e10 ? 1 : 1000)) <= visibleLastTimestamp;
    }) || [],
    lines: drawings.lines?.filter((l: any) => {
      const idx = Math.floor(l.x1);
      return idx < chartData.length && (typeof chartData[idx].time === 'string' ? new Date(chartData[idx].time).getTime() : chartData[idx].time * (chartData[idx].time > 1e10 ? 1 : 1000)) <= visibleLastTimestamp;
    }) || [],
    labels: drawings.labels?.filter((l: any) => {
      const idx = Math.floor(l.x);
      return idx < chartData.length && (typeof chartData[idx].time === 'string' ? new Date(chartData[idx].time).getTime() : chartData[idx].time * (chartData[idx].time > 1e10 ? 1 : 1000)) <= visibleLastTimestamp;
    }) || [],
  } : drawings;

  // --- Resizing logic ---
  useEffect(() => {
    if (!isResizing) return;
    const handlePointerMove = (e: PointerEvent) => {
      const newHeight = window.innerHeight - e.clientY;
      if (newHeight > 100 && newHeight < window.innerHeight * 0.85) {
        setBottomPanelHeight(newHeight);
      }
    };
    const handlePointerUp = () => setIsResizing(false);
    
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isResizing]);

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
    skipRawReloadRef.current = true;
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

      // Trade position boxes
      const mappedBoxes: any[] = [];
      data.metrics.trades.forEach((t: any) => {
        mappedBoxes.push({
          entryTime: t.entryTime,
          exitTime: t.exitTime,
          entryPrice: t.entryPrice,
          exitPrice: t.exitPrice,
          tp: t.tp,
          sl: t.sl,
          direction: t.direction,
          pnl: t.pnl,
        });
      });
      setTradeBoxes(mappedBoxes);
      setShowTester(true);
      setActiveBottomTab('tester');
    } catch (err: any) {
      const message = err?.message || (typeof err === 'string' ? err : JSON.stringify(err));
      setError(message || 'Backtest failed');
    } finally {
      setIsBacktesting(false);
    }
  }, [code, selectedDatasetId, viewTimeframe, selectedDataset]);

  // Auto-load raw data immediately on dataset/timeframe selection
  useEffect(() => {
    if (!selectedDatasetId) return;
    if (isBacktesting) return;
    if (skipRawReloadRef.current) {
      skipRawReloadRef.current = false;
      return;
    }

    const loadData = async () => {
      try {
        const res = await fetch('/api/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            datasetId: selectedDatasetId,
            viewTimeframe: viewTimeframe || selectedDataset?.timeframe,
          }),
        });
        const data = await res.json();
        if (data.bars) {
          setChartData(data.bars);
          setDatasetInfo(data.datasetInfo);
          setTradeBoxes([]);
          setDrawings(null);
          setIndicatorSeries({});
        }
      } catch (err) {
        console.error('Failed to load chart data:', err);
      }
    };
    loadData();
  }, [selectedDatasetId, viewTimeframe, selectedDataset, isBacktesting]);

  const changeBar = lastBar || {};
  const isUp = changeBar.close >= changeBar.open;

  return (
    <div className={styles.container}>
      {/* ═══ TOP TOOLBAR ═══ */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarGroup}>
          {/* Symbol selector */}
          <div className={styles.brandLogo}>
            <span className={styles.brandMark}>PL</span>
            <span className={styles.brandName}>PineLabs</span>
          </div>
          <div className={styles.toolbarDivider} />
          
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
        <button className={styles.toolBtn} title="Indicators" onClick={() => setShowIndicatorModal(true)}>
          <IconIndicators /> Indicators
        </button>
        <button
          className={activeBottomTab === 'editor' && showEditor ? styles.toolBtnActive : styles.toolBtn}
          onClick={() => { setShowEditor(!showEditor); setActiveBottomTab('editor'); }}
        >
          <IconCode /> Pine Editor
        </button>
        <button
          className={showTester ? styles.toolBtnActive : styles.toolBtn}
          onClick={() => setShowTester(!showTester)}
        >
          <IconStrategy /> Strategy Tester
        </button>

        <div className={styles.toolbarDivider} />
        
        {/* Replay Button */}
        <button
          className={isReplayActive ? styles.toolBtnActive : styles.toolBtn}
          onClick={() => {
            setIsReplayActive(!isReplayActive);
            if (isReplayActive) {
              setReplayIndex(null);
              setIsReplaying(false);
            }
          }}
          title="Bar Replay"
        >
          <IconReplay /> Replay
        </button>

        <div className={styles.spacer} />

        <Link href="/data-manager" className={styles.navBtn} title="Open Data Manager">
          Data Manager
        </Link>
        <button className={styles.navBtn} onClick={() => setShowMarketPanel(value => !value)}>
          {showMarketPanel ? 'Hide Panel' : 'Show Panel'}
        </button>

        {/* Run Backtest */}
        <button
          className={styles.runBtn}
          onClick={runBacktest}
          disabled={isBacktesting || !selectedDatasetId}
        >
          {isBacktesting ? '⏳ Running…' : <><IconPlay /> Run Backtest</>}
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
          <button className={!activeDrawingTool ? styles.sideBtnActive : styles.sideBtn} title="Crosshair" onClick={() => setActiveDrawingTool(null)}><IconCrosshair /></button>
          <div style={{ width: '20px', height: '1px', background: '#2a2e39', margin: '4px 0' }} />
          <button className={activeDrawingTool === 'trendline' ? styles.sideBtnActive : styles.sideBtn} title="Trend Line" onClick={() => setActiveDrawingTool('trendline')}><IconTrendLine /></button>
          <button className={activeDrawingTool === 'hline' ? styles.sideBtnActive : styles.sideBtn} title="Horizontal Line" onClick={() => setActiveDrawingTool('hline')}><div style={{fontSize:'10px',fontWeight:'bold'}}>-</div></button>
          <button className={activeDrawingTool === 'fib' ? styles.sideBtnActive : styles.sideBtn} title="Fibonacci Retracement" onClick={() => setActiveDrawingTool('fib')}><IconFib /></button>
          <button className={styles.sideBtn} title="Brush" onClick={() => alert('Drawing tools coming soon')}><IconBrush /></button>
          <button className={styles.sideBtn} title="Text" onClick={() => alert('Drawing tools coming soon')}><IconText /></button>
          <div style={{ flex: 1 }} />
          <button className={styles.sideBtn} title="Magnet Mode" onClick={() => alert('Magnet Mode coming soon')}><IconMagnet /></button>
          <button className={styles.sideBtn} title="Remove Drawings" onClick={() => { setDrawings(null); setTradeBoxes([]); setUserDrawings([]); }}><IconTrash /></button>
        </div>

        {/* Chart + bottom panels */}
        <div className={styles.chartArea}>
          {/* Chart */}
          <div className={styles.chartWrapper}>
            {/* Replay Control Panel */}
            {isReplayActive && replayIndex !== null && (
              <div className={styles.replayBottomPanel}>
                <button className={styles.replayBtn} onClick={() => setIsReplaying(!isReplaying)} title={isReplaying ? "Pause" : "Play"}>
                  {isReplaying ? <IconPause /> : <IconPlay />}
                </button>
                <button className={styles.replayBtn} onClick={() => {
                  if (!isReplaying && replayIndex < chartData.length - 1) setReplayIndex(replayIndex + 1);
                }} title="Forward">
                  <IconForward />
                </button>
                
                <div className={styles.customSpeedDropdown}>
                  <button className={styles.customSpeedBtn} onClick={() => setShowSpeedMenu(!showSpeedMenu)}>
                    {replaySpeed === 2000 ? '0.5x' : replaySpeed === 1000 ? '1x' : replaySpeed === 500 ? '2x' : '5x'}
                  </button>
                  {showSpeedMenu && (
                    <div className={styles.customSpeedMenu}>
                      <button onClick={() => { setReplaySpeed(2000); setShowSpeedMenu(false); }}>0.5x</button>
                      <button onClick={() => { setReplaySpeed(1000); setShowSpeedMenu(false); }}>1x</button>
                      <button onClick={() => { setReplaySpeed(500); setShowSpeedMenu(false); }}>2x</button>
                      <button onClick={() => { setReplaySpeed(200); setShowSpeedMenu(false); }}>5x</button>
                    </div>
                  )}
                </div>

                <div style={{ width: '1px', height: '16px', background: '#363a45', margin: '0 4px' }} />
                <button className={styles.replayBtn} onClick={() => { setIsReplayActive(false); setIsReplaying(false); setReplayIndex(null); }} title="Close">
                  <IconClose />
                </button>
              </div>
            )}
            
            {/* Select Bar Helper */}
            {isReplayActive && replayIndex === null && (
              <div className={styles.selectBarHelper}>
                Select bar <button onClick={() => setIsReplayActive(false)}><IconClose /></button>
              </div>
            )}
            
            {chartData.length > 0 ? (
              <>
                <Chart 
                  data={visibleChartData} 
                  tradeBoxes={visibleBoxes}
                  drawings={visibleDrawings} 
                  userDrawings={userDrawings}
                  setUserDrawings={setUserDrawings}
                  activeDrawingTool={activeDrawingTool}
                  indicatorSeries={visibleIndicatorSeries} 
                  datasetInfo={datasetInfo || undefined} 
                  timeRangeTrigger={timeRangeTrigger}
                  goToTimestamp={goToTimestamp}
                  isReplayActive={isReplayActive}
                  replayIndex={replayIndex}
                  onSelectReplayBar={(index: number) => { if (isReplayActive && replayIndex === null) setReplayIndex(index); }}
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
              <button 
                key={range} 
                className={timeRangeTrigger.startsWith(range) ? styles.timeTfBtnActive || styles.timeTfBtn : styles.timeTfBtn}
                onClick={() => setTimeRangeTrigger(range + '_' + Date.now().toString())}
              >
                {range}
              </button>
            ))}
            <button className={styles.timeTfBtn} onClick={() => setShowGoToModal(true)} title="Go to date" style={{ padding: '0 6px', display: 'flex', alignItems: 'center' }}>
              <IconCalendar />
            </button>
            <span className={styles.timeInfo} suppressHydrationWarning>
              {new Date().toLocaleTimeString('en-US', { hour12: false })} UTC{new Date().getTimezoneOffset() > 0 ? '-' : '+'}{Math.abs(new Date().getTimezoneOffset() / 60)}
            </span>
          </div>

          {/* ═══ BOTTOM PANELS ═══ */}
          {(showTester || showEditor) && (
            <>
              {/* Resizer Handle */}
              <div 
                className={styles.resizer}
                onPointerDown={(e) => { e.preventDefault(); setIsResizing(true); }}
                style={{
                  height: '5px',
                  backgroundColor: isResizing ? '#2962ff' : '#2b2b43',
                  cursor: 'row-resize',
                  width: '100%',
                  zIndex: 50,
                  transition: 'background-color 0.2s'
                }}
              />
              <div className={styles.bottomPanels} style={{ height: bottomPanelHeight, flexShrink: 0 }}>
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
            </>
          )}
        </div>
        {showMarketPanel && <aside className={styles.marketPanel} aria-label="Market data panel">
          <div className={styles.marketPanelHeader}>
            <span>MARKETS</span>
            <Link href="/data-manager" className={styles.marketPanelLink}>Manage</Link>
          </div>
          <div className={styles.marketPanelSectionTitle}>Datasets</div>
          {datasets.length === 0 ? (
            <div className={styles.marketEmpty}>No datasets loaded</div>
          ) : datasets.map(dataset => (
            <button
              key={dataset.id}
              className={String(dataset.id) === selectedDatasetId ? styles.marketRowActive : styles.marketRow}
              onClick={() => {
                setSelectedDatasetId(String(dataset.id));
                setViewTimeframe(dataset.timeframe);
              }}
            >
              <span>
                <strong>{dataset.symbol}</strong>
                <small>{dataset.source_name} · {dataset.timeframe.toUpperCase()}</small>
              </span>
              <span className={styles.marketCount}>{dataset.candle_count.toLocaleString()}</span>
            </button>
          ))}
          <div className={styles.marketPanelSectionTitle}>Active View</div>
          <div className={styles.marketSummary}>
            <span>Symbol <strong>{selectedDataset?.symbol || '—'}</strong></span>
            <span>Interval <strong>{viewTimeframe.toUpperCase()}</strong></span>
            <span>Bars <strong>{chartData.length.toLocaleString()}</strong></span>
            <span>Signals <strong>{metrics?.num_trades ?? 0}</strong></span>
          </div>
          <div className={styles.marketPanelSectionTitle}>Indicators</div>
          {Object.keys(mergedIndicatorSeries).length === 0 ? (
            <div className={styles.marketEmpty}>No indicators applied</div>
          ) : Object.keys(mergedIndicatorSeries).map(name => (
            <div className={styles.indicatorRow} key={name}>
              <span className={styles.indicatorName}>{name.replace('_', ' ')}</span>
              <button className={styles.indicatorHide} onClick={() => setHiddenIndicators(prev => [...prev, name])}>Hide</button>
              <button className={styles.indicatorRemove} onClick={() => {
                setHiddenIndicators(prev => prev.filter(item => item !== name));
                if (name.startsWith('SMA')) setActiveNativeIndicators(prev => prev.filter(item => item !== 'sma20'));
                if (name.startsWith('EMA')) setActiveNativeIndicators(prev => prev.filter(item => item !== 'ema20'));
                if (name.startsWith('BB')) setActiveNativeIndicators(prev => prev.filter(item => item !== 'bb'));
              }}>×</button>
            </div>
          ))}
          {hiddenIndicators.length > 0 && (
            <button className={styles.showIndicators} onClick={() => setHiddenIndicators([])}>Show hidden ({hiddenIndicators.length})</button>
          )}
        </aside>}
      </div>

      {/* Indicator Modal */}
      {showIndicatorModal && (
        <div className={styles.modalBackdrop} onClick={() => setShowIndicatorModal(false)}>
          <div className={styles.indicatorModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.indicatorModalHeader}>
              <h2>Indicators, Metrics & Strategies</h2>
              <button className={styles.indicatorModalClose} onClick={() => setShowIndicatorModal(false)}>
                <IconClose />
              </button>
            </div>
            <div className={styles.indicatorList}>
            <div style={{ padding: '0 8px 8px', color: '#787b86', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.5px' }}>BUILT-IN</div>
            {[
              { id: 'sma20', name: 'Simple Moving Average (20)' },
              { id: 'ema20', name: 'Exponential Moving Average (20)' },
              { id: 'bb', name: 'Bollinger Bands (20, 2)' }
            ].map(ind => {
              const isActive = activeNativeIndicators.includes(ind.id);
              return (
                <div key={ind.id} className={styles.indicatorItem}>
                  <span>{ind.name}</span>
                  {isActive ? (
                    <button className={styles.indicatorRemoveBtn} onClick={() => setActiveNativeIndicators(prev => prev.filter(i => i !== ind.id))}>Remove</button>
                  ) : (
                    <button className={styles.indicatorAddBtn} onClick={() => {
                      setActiveNativeIndicators(prev => [...prev, ind.id]);
                      setHiddenIndicators(prev => prev.filter(name => !name.startsWith(ind.name.split(' ')[0])));
                    }}>Add</button>
                  )}
                </div>
              );
            })}

            <div style={{ padding: '16px 8px 8px', color: '#787b86', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.5px' }}>MY SCRIPTS</div>
            <div className={styles.indicatorItem}>
              <span>Active Pine Script</span>
              {Object.keys(indicatorSeries).length > 0 || tradeBoxes.length > 0 ? (
                <button className={styles.indicatorRemoveBtn} onClick={() => {
                  setIndicatorSeries({});
                  setTradeBoxes([]);
                  setDrawings(null);
                }}>Remove</button>
              ) : (
                <button className={styles.indicatorAddBtn} onClick={() => {
                  setShowIndicatorModal(false);
                  runBacktest();
                }}>
                  {isBacktesting ? 'Adding...' : 'Add'}
                </button>
              )}
            </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Go To Modal ── */}
      {showGoToModal && (
        <div className={styles.modalBackdrop} onClick={() => setShowGoToModal(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span>Go to</span>
              <button className={styles.modalClose} onClick={() => setShowGoToModal(false)}>✕</button>
            </div>
            
            <div className={styles.modalInputGroup}>
              <input 
                type="date" 
                className={styles.modalInput} 
                value={goToDateStr}
                onChange={(e) => setGoToDateStr(e.target.value)}
              />
              <input 
                type="time" 
                className={styles.modalInput} 
                value={goToTimeStr}
                onChange={(e) => setGoToTimeStr(e.target.value)}
              />
            </div>
            
            <div className={styles.modalFooter}>
              <button className={styles.modalBtn} onClick={() => setShowGoToModal(false)}>Cancel</button>
              <button 
                className={styles.modalBtnPrimary} 
                onClick={() => {
                  if (goToDateStr) {
                    const ts = new Date(`${goToDateStr}T${goToTimeStr}:00Z`).getTime(); // assuming UTC or let browser parse
                    // Actually let's just do local parse:
                    const localTs = new Date(`${goToDateStr}T${goToTimeStr}:00`).getTime();
                    setGoToTimestamp(localTs);
                  }
                  setShowGoToModal(false);
                }}
              >
                Go to
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
