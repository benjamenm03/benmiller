const NODE_INFO = {
    "1": { channel: "2996904", readKey: "REPLACE_WITH_KEY1" },
    "2": { channel: "2996908", readKey: "REPLACE_WITH_KEY2" },
    "3": { channel: "2996910", readKey: "REPLACE_WITH_KEY3" },
    "4": { channel: "2996911", readKey: "REPLACE_WITH_KEY4" }
};

function formatDateForAPI(datetimeStr, tz) {
    if (!datetimeStr) return '';
    var date;
    if (tz === 'local') {
        date = new Date(datetimeStr);
    } else if (tz === 'UTC') {
        date = new Date(datetimeStr + 'Z');
    } else {
        date = new Date(datetimeStr + tz);
    }
    return encodeURIComponent(date.toISOString().replace('T', ' ').slice(0, 19));
}

function fetchCsv(node, start, end) {
    var info = NODE_INFO[node];
    var url = `https://api.thingspeak.com/channels/${info.channel}/feeds.csv?api_key=${info.readKey}&start=${start}&end=${end}`;
    return fetch(url).then(function(resp) { return resp.text(); });
}

function parseCsv(text) {
    var lines = text.trim().split(/\r?\n/);
    var headers = lines[0].split(',');
    var rows = {};
    for (var i = 1; i < lines.length; i++) {
        var parts = lines[i].split(',');
        var row = {};
        for (var j = 0; j < headers.length; j++) {
            row[headers[j]] = parts[j];
        }
        rows[row.created_at] = row;
    }
    return { headers: headers, rows: rows };
}

function combineCsv(results) {
    var timestamps = new Set();
    results.forEach(function(r) {
        Object.keys(r.data.rows).forEach(function(ts) { timestamps.add(ts); });
    });
    var sorted = Array.from(timestamps).sort();

    var header = ['timestamp'];
    results.forEach(function(res) {
        res.data.headers.forEach(function(h) {
            if (h === 'created_at' || h === 'entry_id') return;
            header.push('node' + res.node + '_' + h);
        });
    });

    var rows = sorted.map(function(ts) {
        var parts = [ts];
        results.forEach(function(res) {
            res.data.headers.forEach(function(h) {
                if (h === 'created_at' || h === 'entry_id') return;
                var row = res.data.rows[ts];
                parts.push(row ? (row[h] || '') : '');
            });
        });
        return parts.join(',');
    });

    return header.join(',') + '\n' + rows.join('\n');
}

function initDownloadForm() {
    var form = document.getElementById('download-form');
    if (!form) return;
    form.addEventListener('submit', function(e) {
        e.preventDefault();
        var node = document.getElementById('node-select').value;
        var startIn = document.getElementById('start').value;
        var endIn = document.getElementById('end').value;
        var tz = document.getElementById('timezone-select').value;
        if (!startIn || !endIn) return;
        var start = formatDateForAPI(startIn, tz);
        var end = formatDateForAPI(endIn, tz);

        function download(csv, name) {
            var blob = new Blob([csv], { type: 'text/csv' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }

        if (node === 'all') {
            var nodes = Object.keys(NODE_INFO);
            Promise.all(nodes.map(function(n) {
                return fetchCsv(n, start, end).then(function(csv) {
                    return { node: n, data: parseCsv(csv) };
                });
            })).then(function(results) {
                var combined = combineCsv(results);
                download(combined, 'all_nodes_data.csv');
            }).catch(function(err) {
                console.error('Download failed:', err);
            });
        } else if (NODE_INFO[node]) {
            fetchCsv(node, start, end)
                .then(function(csv) {
                    download(csv, `node${node}_data.csv`);
                })
                .catch(function(err) {
                    console.error('Download failed:', err);
                });
        }
    });
}

document.addEventListener('DOMContentLoaded', initDownloadForm);
