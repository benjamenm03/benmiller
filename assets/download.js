const NODE_INFO = {
    "1": { channel: "2996904", readKey: "REPLACE_WITH_KEY1" },
    "2": { channel: "2996908", readKey: "REPLACE_WITH_KEY2" },
    "3": { channel: "2996910", readKey: "REPLACE_WITH_KEY3" },
    "4": { channel: "2996911", readKey: "REPLACE_WITH_KEY4" }
};

function initDownloadForm() {
    var form = document.getElementById('download-form');
    if (!form) return;
    form.addEventListener('submit', function(e) {
        e.preventDefault();
        var node = document.getElementById('node-select').value;
        var start = document.getElementById('start').value;
        var end = document.getElementById('end').value;
        if (!NODE_INFO[node] || !start || !end) return;
        var info = NODE_INFO[node];
        var startStr = encodeURIComponent(start.replace('T', ' ') + ':00');
        var endStr = encodeURIComponent(end.replace('T', ' ') + ':00');
        var url = `https://api.thingspeak.com/channels/${info.channel}/feeds.csv?api_key=${info.readKey}&start=${startStr}&end=${endStr}`;
        fetch(url)
            .then(function(resp) { return resp.text(); })
            .then(function(csv) {
                var blob = new Blob([csv], { type: 'text/csv' });
                var a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `node${node}_data.csv`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            })
            .catch(function(err) {
                console.error('Download failed:', err);
            });
    });
}

document.addEventListener('DOMContentLoaded', initDownloadForm);
