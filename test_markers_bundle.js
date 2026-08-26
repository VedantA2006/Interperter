import { createChart, createSeriesMarkers } from 'lightweight-charts';

const chart = createChart(document.getElementById('tvchart'), { width: 800, height: 600 });
const lineSeries = chart.addLineSeries();
lineSeries.setData([
    { time: '2019-04-11', value: 80.01 },
    { time: '2019-04-12', value: 96.63 },
    { time: '2019-04-13', value: 76.64 },
    { time: '2019-04-14', value: 81.89 },
    { time: '2019-04-15', value: 74.43 },
    { time: '2019-04-16', value: 80.01 },
]);

const markers = [
    { time: '2019-04-12', position: 'aboveBar', color: 'black', shape: 'arrowDown', size: 1, text: 'Sell' },
    { time: '2019-04-15', position: 'belowBar', color: 'red', shape: 'arrowUp', text: 'Buy', size: 2 },
];

const seriesMarkers = createSeriesMarkers(lineSeries, markers);
console.log('Markers attached?', seriesMarkers);
